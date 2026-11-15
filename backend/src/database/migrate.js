const fs = require('node:fs/promises');
const path = require('node:path');
const { pool } = require('../config/database');

const migrationsDirectory = path.join(__dirname, 'migrations');

async function runMigrations() {
  const client = await pool.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const migrationFiles = (await fs.readdir(migrationsDirectory))
      .filter((fileName) => fileName.endsWith('.sql'))
      .sort();

    for (const fileName of migrationFiles) {
      const { rowCount } = await client.query(
        'SELECT 1 FROM schema_migrations WHERE name = $1',
        [fileName],
      );

      if (rowCount > 0) {
        console.log(`Skipping already applied migration: ${fileName}`);
        continue;
      }

      const migrationSql = await fs.readFile(
        path.join(migrationsDirectory, fileName),
        'utf8',
      );

      console.log(`Applying migration: ${fileName}`);
      await client.query('BEGIN');

      try {
        await client.query(migrationSql);
        await client.query(
          'INSERT INTO schema_migrations (name) VALUES ($1)',
          [fileName],
        );
        await client.query('COMMIT');
        console.log(`Migration applied successfully: ${fileName}`);
      } catch (error) {
        await client.query('ROLLBACK');
        console.error(`Migration failed: ${fileName}`);
        throw error;
      }
    }

    console.log('Database migrations completed successfully.');
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  runMigrations().catch((error) => {
    console.error('Database migration runner failed:', error);
    process.exitCode = 1;
  });
}

module.exports = { runMigrations };
