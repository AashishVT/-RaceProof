#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');

const rootEnvPath = path.resolve(__dirname, '../../.env.local');
if (!fs.existsSync(rootEnvPath)) throw new Error('Root .env.local is required for the seed migration.');
const rootEnv = dotenv.parse(fs.readFileSync(rootEnvPath));
const databaseName = (value) => {
  try { return new URL(value).pathname.replace(/^\/+/, ''); } catch { return null; }
};

if (process.env.SEED_ENVIRONMENT !== 'non-production') {
  throw new Error('Set SEED_ENVIRONMENT=non-production to confirm the seed target is not production.');
}
const seedName = databaseName(rootEnv.SEED_DATABASE_URL);
if (seedName !== 'raceproof_seed') throw new Error('SEED_DATABASE_URL must target exactly raceproof_seed.');
if (/prod(?:uction)?/i.test(new URL(rootEnv.SEED_DATABASE_URL).hostname)) throw new Error('Production hosts are refused.');
if (databaseName(rootEnv.DATABASE_URL) !== 'neondb' || databaseName(rootEnv.TEST_DATABASE_URL) !== 'raceproof_test') {
  throw new Error('Expected neondb and raceproof_test URLs must be configured in root .env.local.');
}
if ([rootEnv.DATABASE_URL, rootEnv.TEST_DATABASE_URL].includes(rootEnv.SEED_DATABASE_URL)) {
  throw new Error('Seed, development, and test database URLs must be distinct.');
}

process.env.DATABASE_URL = rootEnv.SEED_DATABASE_URL;
process.env.DB_NAME = 'raceproof_seed';
process.env.NODE_ENV = 'development';

const { pool } = require('../src/config/database');
const { runMigrations } = require('../src/database/migrate');

async function main() {
  const identity = await pool.query('SELECT current_database() AS name');
  if (identity.rows[0].name !== 'raceproof_seed') {
    throw new Error('Connected database identity is not raceproof_seed; migrations were not run.');
  }
  console.log('Seed migration target verified: raceproof_seed.');
  await runMigrations();
}

main().catch(async (error) => {
  console.error(`Seed migration failed: ${error.code || error.name || 'database error'}`);
  await pool.end().catch(() => {});
  process.exitCode = 1;
});
