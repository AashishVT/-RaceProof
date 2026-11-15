const AppError = require('../utils/app-error');

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const MAX_ATTEMPTS_PER_IP = 100;
const attemptsByUser = new Map();
const attemptsByIp = new Map();

function consumeAttempt(map, key, now, limit) {
  let state = map.get(key);
  if (!state || state.resetAt <= now) {
    state = { count: 0, resetAt: now + WINDOW_MS };
    map.set(key, state);
  }
  state.count += 1;
  return { remaining: Math.max(0, limit - state.count), resetAt: state.resetAt, exceeded: state.count > limit };
}

function discardExpiredEntries(map, now) {
  for (const [key, value] of map) {
    if (value.resetAt <= now) map.delete(key);
  }
}

function limitInviteRedemptions(request, response, next) {
  const key = request.user.id;
  const ipKey = request.ip || 'unknown';
  const now = Date.now();
  const userAttempt = consumeAttempt(attemptsByUser, key, now, MAX_ATTEMPTS);
  const ipAttempt = consumeAttempt(attemptsByIp, ipKey, now, MAX_ATTEMPTS_PER_IP);
  if (attemptsByUser.size > 1000) discardExpiredEntries(attemptsByUser, now);
  if (attemptsByIp.size > 1000) discardExpiredEntries(attemptsByIp, now);
  response.set('RateLimit-Limit', String(MAX_ATTEMPTS));
  response.set('RateLimit-Remaining', String(Math.min(userAttempt.remaining, ipAttempt.remaining)));

  if (userAttempt.exceeded || ipAttempt.exceeded) {
    response.set('Retry-After', String(Math.ceil((Math.min(userAttempt.resetAt, ipAttempt.resetAt) - now) / 1000)));
    return next(new AppError('Too many invite attempts. Try again later.', 429));
  }

  return next();
}

module.exports = limitInviteRedemptions;
