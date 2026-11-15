const dotenv = require('dotenv');
const path = require('node:path');

dotenv.config({ path: path.resolve(__dirname, '../../../.env.local') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const port = Number.parseInt(process.env.PORT || '3000', 10);
const databasePort = Number.parseInt(process.env.DB_PORT || '5432', 10);
const databasePoolMax = Number.parseInt(process.env.DB_POOL_MAX || '10', 10);
const bcryptSaltRounds = Number.parseInt(process.env.BCRYPT_SALT_ROUNDS || '12', 10);
const isTestDatabase = process.env.NODE_ENV === 'test' || /_test$/i.test(process.env.DB_NAME || '');
const developmentDatabaseUrl = process.env.DATABASE_URL || '';
const testDatabaseUrl = process.env.TEST_DATABASE_URL || '';

if (process.env.NODE_ENV === 'test') {
  if (!testDatabaseUrl) {
    throw new Error('TEST_DATABASE_URL must be configured before running tests.');
  }

  let testDatabaseName;
  let developmentDatabaseName;
  try {
    testDatabaseName = new URL(testDatabaseUrl).pathname.replace(/^\/+/, '');
    developmentDatabaseName = developmentDatabaseUrl
      ? new URL(developmentDatabaseUrl).pathname.replace(/^\/+/, '')
      : process.env.DB_NAME || '';
  } catch {
    throw new Error('Database URLs must be valid before running tests.');
  }

  if (!/_test$/i.test(testDatabaseName)) {
    throw new Error('TEST_DATABASE_URL must target a database whose name ends in _test.');
  }

  if (!['localhost', '127.0.0.1', '::1'].includes(new URL(testDatabaseUrl).hostname)) {
    throw new Error('TEST_DATABASE_URL must target local PostgreSQL; remote test databases are refused.');
  }

  if (developmentDatabaseName && testDatabaseName === developmentDatabaseName) {
    throw new Error('TEST_DATABASE_URL must target a database separate from DATABASE_URL.');
  }
}

const databaseUrl = isTestDatabase ? testDatabaseUrl : developmentDatabaseUrl;

let configuredDatabaseName = process.env.DB_NAME || 'raceproof';

if (databaseUrl) {
  configuredDatabaseName = new URL(databaseUrl).pathname.replace(/^\/+/, '');
}

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}

if (!Number.isInteger(databasePort) || databasePort < 1 || databasePort > 65535) {
  throw new Error('DB_PORT must be an integer between 1 and 65535.');
}

if (!Number.isInteger(databasePoolMax) || databasePoolMax < 1) {
  throw new Error('DB_POOL_MAX must be a positive integer.');
}

if (!Number.isInteger(bcryptSaltRounds) || bcryptSaltRounds < 10 || bcryptSaltRounds > 15) {
  throw new Error('BCRYPT_SALT_ROUNDS must be an integer between 10 and 15.');
}

module.exports = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port,
  corsOrigin: process.env.CORS_ORIGIN || '*',
  jwtSecret: process.env.JWT_SECRET || '',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '15m',
  bcryptSaltRounds,
  dbTiming: process.env.DB_TIMING === '1',
  database: {
    ...(databaseUrl
      ? { connectionString: databaseUrl }
      : {
          host: process.env.DB_HOST || 'localhost',
          port: databasePort,
          database: configuredDatabaseName,
          user: process.env.DB_USER || 'raceproof',
          password: process.env.DB_PASSWORD || '',
        }),
    max: databasePoolMax,
    idleTimeoutMillis: Number.parseInt(process.env.DB_IDLE_TIMEOUT_MS || '30000', 10),
    connectionTimeoutMillis: Number.parseInt(
      process.env.DB_CONNECTION_TIMEOUT_MS || '120000',
      10,
    ),
  },
  databaseName: configuredDatabaseName,
};
