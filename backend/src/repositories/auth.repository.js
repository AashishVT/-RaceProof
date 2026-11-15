const { pool } = require('../config/database');

const safeUserColumns = `
  id,
  name,
  email,
  skills,
  time_zone AS "timeZone",
  created_at AS "createdAt"
`;

async function createUser({ name, email, passwordHash }) {
  const result = await pool.query(
    `
      INSERT INTO users (name, email, password_hash)
      VALUES ($1, $2, $3)
      ON CONFLICT DO NOTHING
      RETURNING ${safeUserColumns}
    `,
    [name, email, passwordHash],
  );

  return result.rows[0] || null;
}

async function findUserByEmail(email) {
  const result = await pool.query(
    `
      SELECT ${safeUserColumns}, password_hash AS "passwordHash"
      FROM users
      WHERE LOWER(email) = $1
      LIMIT 1
    `,
    [email],
  );

  return result.rows[0] || null;
}

async function findUserById(userId) {
  const result = await pool.query(
    `
      SELECT ${safeUserColumns}
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
    [userId],
  );

  return result.rows[0] || null;
}

module.exports = { createUser, findUserByEmail, findUserById };
