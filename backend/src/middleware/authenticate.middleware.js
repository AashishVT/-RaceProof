const jwt = require('jsonwebtoken');
const AppError = require('../utils/app-error');
const { requireJwtSecret } = require('../services/auth.service');

function authenticate(request, _response, next) {
  const authorization = request.get('authorization');
  const match = authorization && authorization.match(/^Bearer\s+([^\s]+)$/i);

  if (!match) {
    return next(new AppError('Authentication required.', 401));
  }

  let secret;

  try {
    secret = requireJwtSecret();
  } catch (error) {
    return next(error);
  }

  try {
    const payload = jwt.verify(match[1], secret);

    if (!payload || typeof payload !== 'object' || typeof payload.userId !== 'string') {
      return next(new AppError('Invalid or expired token.', 401));
    }

    request.user = { id: payload.userId };
    return next();
  } catch (_error) {
    return next(new AppError('Invalid or expired token.', 401));
  }
}

module.exports = authenticate;
