#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const dotenv = require('dotenv');
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const bcrypt = require('bcrypt');
const { Pool } = require('pg');

const PREFIX = 'raceproof-seed-v1';
const USER_COUNT = 10_000;
const HACKATHON_COUNT = 4;
const TEAMS_PER_HACKATHON = 500;
const TEAM_COUNT = HACKATHON_COUNT * TEAMS_PER_HACKATHON;
const BATCH_SIZE = 250;
const SKILLS = [
  'JavaScript', 'React', 'Node.js', 'PostgreSQL', 'Python', 'Machine Learning',
  'UI/UX', 'Figma', 'Product Management', 'TypeScript', 'Express', 'Docker',
  'Data Science', 'Cloud', 'Accessibility', 'Security', 'DevOps', 'Java',
  'Go', 'Mobile', 'API Design', 'Testing', 'CSS', 'Ruby',
];
const TIME_ZONES = [
  'America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York',
  'America/Sao_Paulo', 'Europe/London', 'Europe/Berlin', 'Africa/Nairobi',
  'Asia/Dubai', 'Asia/Kolkata', 'Asia/Bangkok', 'Asia/Singapore',
  'Asia/Tokyo', 'Australia/Sydney', 'Pacific/Auckland',
];

function stableUuid(label) {
  const bytes = crypto.createHash('sha256').update(`${PREFIX}:${label}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function chunk(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

async function insertBatches(client, table, columns, rows, conflictSql = '') {
  for (const group of chunk(rows, BATCH_SIZE)) {
    const values = [];
    const placeholders = group.map((row, rowIndex) => `(${row.map((value, columnIndex) => {
      values.push(value);
      return `$${rowIndex * columns.length + columnIndex + 1}`;
    }).join(', ')})`);
    await client.query(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${placeholders.join(', ')} ${conflictSql}`,
      values,
    );
  }
}

function participantRows(passwordHash) {
  return Array.from({ length: USER_COUNT }, (_unused, index) => {
    const number = index + 1;
    const skillCount = 3 + (index % 4);
    const skills = Array.from({ length: skillCount }, (_value, offset) => SKILLS[(index * 7 + offset * 5) % SKILLS.length]);
    return [
      stableUuid(`participant:${number}`),
      `RaceProof Participant ${String(number).padStart(5, '0')}`,
      `participant${String(number).padStart(5, '0')}@seed.raceproof.invalid`,
      passwordHash,
      [...new Set(skills)],
      TIME_ZONES[(index * 11) % TIME_ZONES.length],
    ];
  });
}

function hackathonRows() {
  return Array.from({ length: HACKATHON_COUNT }, (_unused, index) => [
    stableUuid(`hackathon:${index + 1}`),
    `RaceProof Seed Hackathon ${String(index + 1).padStart(2, '0')}`,
    2,
    5,
    'active',
  ]);
}

function teamRows() {
  const rows = [];
  let participantIndex = 0;
  for (let hackathonIndex = 0; hackathonIndex < HACKATHON_COUNT; hackathonIndex += 1) {
    for (let localTeamIndex = 0; localTeamIndex < TEAMS_PER_HACKATHON; localTeamIndex += 1) {
      const globalTeamIndex = hackathonIndex * TEAMS_PER_HACKATHON + localTeamIndex;
      const size = 3 + (globalTeamIndex % 2);
      rows.push({
        id: stableUuid(`team:${globalTeamIndex + 1}`),
        hackathonId: stableUuid(`hackathon:${hackathonIndex + 1}`),
        name: `RP Seed Team ${String(globalTeamIndex + 1).padStart(4, '0')}`,
        leaderId: stableUuid(`participant:${participantIndex + 1}`),
        size,
        firstParticipantIndex: participantIndex,
      });
      participantIndex += size;
    }
  }
  return rows;
}

async function verifySchema(client) {
  const expected = {
    users: ['id', 'name', 'email', 'password_hash', 'skills', 'time_zone'],
    hackathons: ['id', 'name', 'min_team_size', 'max_team_size', 'status'],
    teams: ['id', 'hackathon_id', 'team_name', 'leader_id', 'leader_role'],
    team_members: ['team_id', 'hackathon_id', 'user_id', 'role'],
  };
  for (const [table, columns] of Object.entries(expected)) {
    const result = await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1`,
      [table],
    );
    const actual = new Set(result.rows.map((row) => row.column_name));
    if (columns.some((column) => !actual.has(column))) {
      throw new Error(`Expected ${table} schema is missing a required column.`);
    }
  }
  const constraints = await client.query(`
    SELECT conname FROM pg_constraint
    WHERE conrelid IN ('teams'::regclass, 'team_members'::regclass)
  `);
  const names = new Set(constraints.rows.map((row) => row.conname));
  for (const required of [
    'teams_hackathon_id_fkey', 'teams_leader_id_fkey', 'teams_leader_must_be_member_fk',
    'teams_leader_role_member_fk', 'team_members_team_hackathon_fk',
    'team_members_user_id_fkey', 'team_members_hackathon_user_unique',
  ]) {
    if (!names.has(required)) throw new Error(`Required integrity constraint is missing: ${required}`);
  }
  const indexes = await client.query(`
    SELECT indexname FROM pg_indexes
    WHERE schemaname = current_schema()
      AND indexname = ANY($1::TEXT[])
  `, [['users_email_lower_unique_idx', 'team_members_one_leader_per_team_idx']]);
  const indexNames = new Set(indexes.rows.map((row) => row.indexname));
  for (const required of ['users_email_lower_unique_idx', 'team_members_one_leader_per_team_idx']) {
    if (!indexNames.has(required)) throw new Error(`Required integrity index is missing: ${required}`);
  }
}

async function verifySeedOwnership(client, users, hackathons, teams) {
  const expectedUsers = new Map(users.map((row) => [row[0], row]));
  const foundUsers = await client.query('SELECT id, name, email FROM users WHERE id = ANY($1::UUID[]) FOR UPDATE', [users.map((row) => row[0])]);
  if (foundUsers.rows.some((row) => {
    const expected = expectedUsers.get(row.id);
    return !expected || row.name !== expected[1] || row.email !== expected[2];
  })) throw new Error('A deterministic participant ID belongs to different data; no seed rows changed.');

  const expectedHackathons = new Map(hackathons.map((row) => [row[0], row]));
  const foundHackathons = await client.query('SELECT id, name FROM hackathons WHERE id = ANY($1::UUID[]) FOR UPDATE', [hackathons.map((row) => row[0])]);
  if (foundHackathons.rows.some((row) => row.name !== expectedHackathons.get(row.id)?.[1])) {
    throw new Error('A deterministic hackathon ID belongs to different data; no seed rows changed.');
  }

  const expectedTeams = new Map(teams.map((team) => [team.id, team]));
  const foundTeams = await client.query('SELECT id, team_name, hackathon_id, leader_id FROM teams WHERE id = ANY($1::UUID[]) FOR UPDATE', [teams.map((team) => team.id)]);
  if (foundTeams.rows.some((row) => {
    const expected = expectedTeams.get(row.id);
    return !expected || row.team_name !== expected.name || row.hackathon_id !== expected.hackathonId || row.leader_id !== expected.leaderId;
  })) throw new Error('A deterministic team ID belongs to different data; no seed rows changed.');
}

async function main() {
  if (process.argv.includes('--help')) {
    console.log('Usage: configure SEED_ENVIRONMENT, SEED_DATABASE_URL, and SEED_PASSWORD privately before npm run db:seed [-- --reset]');
    console.log('Reset requires SEED_RESET=1 and a database name ending in _test or _seed.');
    process.exit(0);
  }
  const seedPassword = process.env.SEED_PASSWORD;
  if (!seedPassword) throw new Error('SEED_PASSWORD must be configured before seeding.');
  const connectionString = process.env.SEED_DATABASE_URL;
  if (!connectionString) throw new Error('SEED_DATABASE_URL must identify the dedicated seed database.');
  if (process.env.SEED_ENVIRONMENT !== 'non-production') {
    throw new Error('Set SEED_ENVIRONMENT=non-production to explicitly confirm this is not production.');
  }
  const parsedUrl = new URL(connectionString);
  const databaseName = parsedUrl.pathname.replace(/^\/+/, '');
  if (/prod(?:uction)?/i.test(parsedUrl.hostname)) throw new Error('Refusing to seed a production host.');
  if (!/(?:_test|_seed)$/i.test(databaseName)) {
    throw new Error('Refusing to seed: database name must end in _test or _seed.');
  }
  const destructiveReset = process.argv.includes('--reset');
  if (destructiveReset && process.env.SEED_RESET !== '1') {
    throw new Error('Reset requires both --reset and SEED_RESET=1.');
  }

  const pool = new Pool({ connectionString, max: 4, connectionTimeoutMillis: 10_000 });
  const client = await pool.connect();
  try {
    const identity = await client.query('SELECT current_database() AS name, current_setting(\'server_version\') AS version');
    if (identity.rows[0].name !== databaseName) throw new Error('Database identity did not match SEED_DATABASE_URL.');
    console.log(`Seed target verified: ${identity.rows[0].name} (PostgreSQL ${identity.rows[0].version}).`);
    await verifySchema(client);
    const hash = await bcrypt.hash(seedPassword, 10);
    const users = participantRows(hash);
    const hackathons = hackathonRows();
    const teams = teamRows();
    const memberships = [];
    for (const team of teams) {
      for (let memberOffset = 0; memberOffset < team.size; memberOffset += 1) {
        memberships.push([
          team.id,
          team.hackathonId,
          stableUuid(`participant:${team.firstParticipantIndex + memberOffset + 1}`),
          memberOffset === 0 ? 'leader' : 'member',
        ]);
      }
    }

    await client.query('BEGIN');
    try {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('raceproof-seed-v1'))");
      await client.query('SET CONSTRAINTS ALL DEFERRED');
      await verifySeedOwnership(client, users, hackathons, teams);
      if (destructiveReset) {
        await client.query('DELETE FROM hackathons WHERE id = ANY($1::UUID[])', [hackathons.map((row) => row[0])]);
        await client.query('DELETE FROM users WHERE id = ANY($1::UUID[])', [users.map((row) => row[0])]);
      }
      await insertBatches(client, 'users', ['id', 'name', 'email', 'password_hash', 'skills', 'time_zone'], users, 'ON CONFLICT (id) DO NOTHING');
      await insertBatches(client, 'hackathons', ['id', 'name', 'min_team_size', 'max_team_size', 'status'], hackathons, 'ON CONFLICT (id) DO NOTHING');
      await insertBatches(client, 'teams', ['id', 'hackathon_id', 'team_name', 'leader_id'], teams.map((team) => [team.id, team.hackathonId, team.name, team.leaderId]), 'ON CONFLICT (id) DO NOTHING');
      await insertBatches(client, 'team_members', ['team_id', 'hackathon_id', 'user_id', 'role'], memberships, 'ON CONFLICT (team_id, user_id) DO NOTHING');

      const actual = await client.query(`
        SELECT
          (SELECT COUNT(*)::INTEGER FROM users WHERE split_part(email, '@', 2) = 'seed.raceproof.invalid' AND left(email, 11) = 'participant') AS users,
          (SELECT COUNT(*)::INTEGER FROM hackathons WHERE id = ANY($1::UUID[])) AS hackathons,
          (SELECT COUNT(*)::INTEGER FROM teams WHERE id = ANY($2::UUID[])) AS teams,
          (SELECT COUNT(*)::INTEGER FROM team_members tm JOIN teams t ON t.id = tm.team_id WHERE t.id = ANY($2::UUID[])) AS memberships,
          (SELECT COUNT(*)::INTEGER FROM teams t JOIN team_members tm ON tm.team_id = t.id AND tm.user_id = t.leader_id AND tm.role = 'leader' WHERE t.id = ANY($2::UUID[])) AS leaders,
          (SELECT COUNT(*)::INTEGER FROM (
            SELECT t.id FROM teams t JOIN hackathons h ON h.id = t.hackathon_id
            LEFT JOIN team_members tm ON tm.team_id = t.id
            WHERE t.id = ANY($2::UUID[])
            GROUP BY t.id, h.min_team_size, h.max_team_size
            HAVING COUNT(tm.user_id) < h.min_team_size OR COUNT(tm.user_id) > h.max_team_size
          ) invalid_sizes) AS invalid_team_sizes,
          (SELECT COUNT(*)::INTEGER FROM teams t JOIN team_members tm ON tm.team_id = t.id
            WHERE t.id = ANY($2::UUID[]) AND tm.hackathon_id <> t.hackathon_id) AS mismatched_hackathon_memberships
      `, [hackathons.map((row) => row[0]), teams.map((team) => team.id)]);
      const counts = actual.rows[0];
      const expectedMemberships = memberships.length;
      if (counts.users !== USER_COUNT || counts.hackathons !== HACKATHON_COUNT || counts.teams !== TEAM_COUNT
        || counts.memberships !== expectedMemberships || counts.leaders !== TEAM_COUNT
        || counts.invalid_team_sizes !== 0 || counts.mismatched_hackathon_memberships !== 0) {
        throw new Error('Seed verification failed; transaction will be rolled back.');
      }
      await client.query('COMMIT');
      console.log(`Seed verified: ${counts.users} participants, ${counts.hackathons} hackathons, ${counts.teams} teams, ${counts.memberships} memberships, ${counts.leaders} consistent leaders; team sizes and hackathon memberships valid.`);
      console.log('Seed login password is reserved for local load testing; see backend/README.md.');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`Seed failed: ${error.message}`);
  process.exitCode = 1;
});
