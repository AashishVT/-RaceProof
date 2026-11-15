const { Pool } = require('pg');
const env = require('./env');

const pool = new Pool(env.database);

pool.on('error', (error) => {
  console.error('Unexpected error from an idle PostgreSQL client:', error);
});

async function checkDatabaseConnection() {
  const result = await pool.query('SELECT 1 AS connected');
  return result.rows[0].connected === 1;
}

module.exports = { pool, checkDatabaseConnection };
