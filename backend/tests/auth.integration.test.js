const { randomUUID } = require('node:crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const app = require('../src/app');
const env = require('../src/config/env');
const { pool } = require('../src/config/database');

const passwords = {
  valid: 'SecurePassword123',
  wrong: 'IncorrectPassword456',
};

const emailsToClean = [];
let databaseReady = false;

function uniqueEmail() {
  const email = `raceproof.${randomUUID()}@example.com`;
  emailsToClean.push(email);
  return email;
}

async function registerUser(overrides = {}) {
  const email = overrides.email || uniqueEmail();
  const response = await request(app)
    .post('/api/auth/register')
    .send({
      name: 'Test Participant',
      email,
      password: passwords.valid,
      ...overrides,
    });

  return { response, email };
}

describe('PostgreSQL-backed authentication integration', () => {
  beforeAll(async () => {
    if (!/_test$/i.test(env.databaseName)) {
      throw new Error(
        'Auth integration tests require a dedicated test database. Set DB_NAME=raceproof_test before running Jest.',
      );
    }

    try {
      const result = await pool.query(
        `
          SELECT column_name
          FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = 'users'
        `,
      );
      const actualColumns = new Set(result.rows.map((row) => row.column_name));
      const requiredColumns = [
        'id', 'name', 'email', 'password_hash', 'skills', 'time_zone', 'created_at',
      ];
      const missingColumns = requiredColumns.filter((column) => !actualColumns.has(column));

      if (missingColumns.length > 0) {
        throw new Error(`users table is missing columns: ${missingColumns.join(', ')}`);
      }

      const emailIndex = await pool.query(
        `
          SELECT 1
          FROM pg_indexes
          WHERE schemaname = current_schema()
            AND tablename = 'users'
            AND indexname = 'users_email_lower_unique_idx'
        `,
      );

      if (emailIndex.rowCount !== 1) {
        throw new Error('users_email_lower_unique_idx is missing; apply the latest migrations.');
      }

      databaseReady = true;
    } catch (error) {
      const reason = error.message || error.code || error.name;
      throw new Error(`Auth integration tests require a reachable, migrated PostgreSQL test database: ${reason}`);
    }
  }, 30000);

  afterAll(async () => {
    try {
      if (databaseReady && emailsToClean.length > 0) {
        await pool.query('DELETE FROM users WHERE email = ANY($1::TEXT[])', [emailsToClean]);
      }
    } finally {
      await pool.end();
    }
  }, 30000);

  test('registers a user and returns a safe profile', async () => {
    const { response } = await registerUser({ email: uniqueEmail() });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      success: true,
      data: {
        user: {
          name: 'Test Participant',
          skills: [],
          timeZone: 'UTC',
        },
      },
    });
    expect(response.body.data.user.email).toMatch(/^raceproof\..+@example\.com$/);
    expect(response.body.data.user).not.toHaveProperty('password_hash');
    expect(response.body.data.user).not.toHaveProperty('passwordHash');

    const storedCredential = await pool.query(
      'SELECT password_hash FROM users WHERE id = $1',
      [response.body.data.user.id],
    );
    expect(storedCredential.rows[0].password_hash).not.toBe(passwords.valid);
    await expect(bcrypt.compare(passwords.valid, storedCredential.rows[0].password_hash))
      .resolves.toBe(true);
  });

  test('normalizes email and rejects duplicate registrations', async () => {
    const email = uniqueEmail();
    const first = await registerUser({ email: email.toUpperCase() });
    const duplicate = await registerUser({ email });

    expect(first.response.status).toBe(201);
    expect(first.response.body.data.user.email).toBe(email.toLowerCase());
    expect(duplicate.response.status).toBe(409);
  });

  test('logs in and returns a signed access token', async () => {
    const { response: registration, email } = await registerUser();
    expect(registration.status).toBe(201);

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email, password: passwords.valid });

    expect(response.status).toBe(200);
    expect(response.body.data.token).toEqual(expect.any(String));
    expect(response.body.data.expiresIn).toBe(env.jwtExpiresIn);
    expect(response.body.data.user.email).toBe(email.toLowerCase());
    expect(response.body.data.user).not.toHaveProperty('passwordHash');
    expect(jwt.verify(response.body.data.token, env.jwtSecret).userId)
      .toBe(registration.body.data.user.id);
  });

  test('rejects an incorrect password without account-specific details', async () => {
    const { response: registration, email } = await registerUser();
    expect(registration.status).toBe(201);

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email, password: passwords.wrong });

    expect(response.status).toBe(401);
    expect(response.body.message).toBe('Invalid email or password.');
  });

  test('returns the same login error for an unknown email', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: uniqueEmail(), password: passwords.valid });

    expect(response.status).toBe(401);
    expect(response.body.message).toBe('Invalid email or password.');
  });

  test('returns the authenticated user profile without a password hash', async () => {
    const { response: registration, email } = await registerUser();
    expect(registration.status).toBe(201);
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email, password: passwords.valid });

    const response = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${login.body.data.token}`);

    expect(login.status).toBe(200);
    expect(response.status).toBe(200);
    expect(response.body.data.user.id).toBe(registration.body.data.user.id);
    expect(response.body.data.user.email).toBe(email.toLowerCase());
    expect(response.body.data.user).not.toHaveProperty('password_hash');
    expect(response.body.data.user).not.toHaveProperty('passwordHash');
  });
});

describe('authentication input validation', () => {
  test('rejects an invalid email', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Test Participant', email: 'not-an-email', password: passwords.valid });

    expect(response.status).toBe(400);
  });

  test('rejects registration when password is missing', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Test Participant', email: 'missing-password@example.com' });

    expect(response.status).toBe(400);
  });
});

describe('JWT authentication middleware', () => {
  test('rejects a request with no bearer token', async () => {
    const response = await request(app).get('/api/auth/me');

    expect(response.status).toBe(401);
  });

  test('rejects an invalid JWT', async () => {
    const response = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer invalid.jwt.token');

    expect(response.status).toBe(401);
  });

  test('rejects an expired JWT', async () => {
    const expiredToken = jwt.sign(
      { userId: randomUUID() },
      env.jwtSecret,
      { expiresIn: '-1s' },
    );
    const response = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${expiredToken}`);

    expect(response.status).toBe(401);
  });
});
