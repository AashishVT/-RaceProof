const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const authRepository = require('../repositories/auth.repository');
const AppError = require('../utils/app-error');

function requireJwtSecret() {
  if (
    !env.jwtSecret
    || env.jwtSecret.toLowerCase().startsWith('replace_with_')
    || Buffer.byteLength(env.jwtSecret, 'utf8') < 32
  ) {
    throw new AppError('JWT_SECRET is not configured.', 500, {
      publicMessage: 'Authentication service is unavailable',
    });
  }

  return env.jwtSecret;
}

function createAccessToken(userId) {
  return jwt.sign({ userId }, requireJwtSecret(), {
    expiresIn: env.jwtExpiresIn,
  });
}

async function register({ name, email, password }) {
  const passwordHash = await bcrypt.hash(password, env.bcryptSaltRounds);

  try {
    const user = await authRepository.createUser({ name, email, passwordHash });

    if (!user) {
      throw new AppError('An account with this email already exists.', 409);
    }

    return user;
  } catch (error) {
    if (error.code === '23505' && error.constraint === 'users_email_key') {
      throw new AppError('An account with this email already exists.', 409);
    }

    throw error;
  }
}

async function login({ email, password }) {
  const user = await authRepository.findUserByEmail(email);

  if (!user) {
    await bcrypt.hash(password, env.bcryptSaltRounds);
    throw new AppError('Invalid email or password.', 401);
  }

  const passwordMatches = await bcrypt.compare(password, user.passwordHash);

  if (!passwordMatches) {
    throw new AppError('Invalid email or password.', 401);
  }

  const { passwordHash: _passwordHash, ...safeUser } = user;

  return {
    token: createAccessToken(user.id),
    expiresIn: env.jwtExpiresIn,
    user: safeUser,
  };
}

async function getCurrentUser(userId) {
  const user = await authRepository.findUserById(userId);

  if (!user) {
    throw new AppError('Authentication required.', 401);
  }

  return user;
}

module.exports = { register, login, getCurrentUser, requireJwtSecret };
