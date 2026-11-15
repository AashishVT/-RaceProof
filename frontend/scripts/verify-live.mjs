import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
process.env.NODE_ENV = 'test';
const env = require('../../backend/src/config/env');
const { pool } = require('../../backend/src/config/database');
const { io } = require('../../backend/node_modules/socket.io-client');
const API = process.env.RACEPROOF_API_URL || 'http://127.0.0.1:3198/api';
const SOCKET = process.env.RACEPROOF_SOCKET_URL || 'http://127.0.0.1:3198';
const localHosts = new Set(['127.0.0.1', 'localhost', '::1']);
const users = [];
let hackathonId;
let teamId;
const sockets = [];
let liveDatabaseVerified = false;

function assertLocalTarget(target, label) {
  const url = new URL(target);
  if (!localHosts.has(url.hostname) || !['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`${label} must point to a local loopback host for live verification.`);
  }
}

function assertLocalTestDatabase() {
  const databaseTarget = env.database.connectionString
    ? new URL(env.database.connectionString).hostname
    : env.database.host;
  if (!localHosts.has(databaseTarget)) {
    throw new Error('Live verification requires a local raceproof_test database.');
  }
}

function safeStatus(label, response, expected) {
  assert.equal(response.status, expected, `${label}: expected HTTP ${expected}, received ${response.status}`);
}

async function api(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await response.json();
  return { response, json };
}

async function registerAndLogin(role) {
  const email = `live-step7.${role}.${randomUUID()}@example.com`;
  const { response: registeredResponse, json: registered } = await api('/auth/register', {
    method: 'POST', body: { name: `Live ${role}`, email, password: 'LiveRaceProof!2026' },
  });
  safeStatus(`${role} registration`, registeredResponse, 201);
  users.push(registered.data.user.id);
  const { response, json } = await api('/auth/login', {
    method: 'POST', body: { email, password: 'LiveRaceProof!2026' },
  });
  safeStatus(`${role} login`, response, 200);
  return { id: json.data.user.id, token: json.data.token };
}

function connectSocket(token) {
  const socket = io(SOCKET, { auth: { token }, transports: ['websocket'], reconnection: false, timeout: 8000 });
  sockets.push(socket);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Live socket connection timed out.')), 10000);
    socket.once('connect', () => { clearTimeout(timer); resolve(socket); });
    socket.once('connect_error', () => { clearTimeout(timer); reject(new Error('Live socket authentication failed.')); });
  });
}

function emitAck(socket, event, payload) {
  return new Promise((resolve, reject) => {
    socket.timeout(5000).emit(event, payload, (error, result) => error ? reject(error) : resolve(result));
  });
}

function nextEvent(socket, name) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${name}.`)), 10000);
    socket.once(name, (payload) => { clearTimeout(timer); resolve(payload); });
  });
}

try {
  assert.equal(env.nodeEnv, 'test', 'Live verification requires NODE_ENV=test.');
  assertLocalTarget(API, 'RACEPROOF_API_URL');
  assertLocalTarget(SOCKET, 'RACEPROOF_SOCKET_URL');
  assertLocalTestDatabase();
  const identity = await pool.query('SELECT current_database() AS name');
  assert.equal(env.databaseName, 'raceproof_test', 'TEST_DATABASE_URL must target raceproof_test.');
  assert.equal(identity.rows[0].name, 'raceproof_test', 'The live test connection must be raceproof_test.');
  liveDatabaseVerified = true;

  const uniqueName = `Live Step 7 ${randomUUID()}`;
  const createdHackathon = await pool.query(
    `INSERT INTO hackathons (name, status, min_team_size, max_team_size)
     VALUES ($1, 'active', 1, 5) RETURNING id`,
    [uniqueName],
  );
  hackathonId = createdHackathon.rows[0].id;

  const leader = await registerAndLogin('leader');
  const applicant = await registerAndLogin('applicant');
  const invitee = await registerAndLogin('invitee');

  let result = await api(`/hackathons?q=${encodeURIComponent(uniqueName)}&status=active&page=1&pageSize=10`, { token: leader.token });
  safeStatus('hackathon directory', result.response, 200);
  assert.equal(result.json.data.hackathons[0]?.id, hackathonId);
  result = await api(`/hackathons/${hackathonId}`, { token: leader.token });
  safeStatus('hackathon detail', result.response, 200);

  result = await api('/teams', { token: leader.token, method: 'POST', body: { hackathonId, teamName: 'Live Team' } });
  safeStatus('team creation', result.response, 201);
  teamId = result.json.data.team.id;
  const leaderSocket = await connectSocket(leader.token);
  const applicantSocket = await connectSocket(applicant.token);
  const inviteeSocket = await connectSocket(invitee.token);
  assert.deepEqual(await emitAck(leaderSocket, 'team:subscribe', { teamId }), { success: true, teamId });

  const joinRequestedEvent = nextEvent(leaderSocket, 'team:join_request_created');
  result = await api(`/teams/${teamId}/join-requests`, { token: applicant.token, method: 'POST', body: {} });
  safeStatus('join request submission', result.response, 201);
  const joinRequestId = result.json.data.joinRequest.id;
  const requestEvent = await joinRequestedEvent;
  assert.equal(requestEvent.teamId, teamId);

  const acceptedOnTeam = nextEvent(leaderSocket, 'team:join_request_accepted');
  const acceptedOnApplicant = nextEvent(applicantSocket, 'team:join_request_accepted');
  result = await api(`/teams/${teamId}/join-requests/${joinRequestId}/accept`, {
    token: leader.token, method: 'POST', body: {},
  });
  safeStatus('leader accepts join request', result.response, 200);
  assert.equal((await acceptedOnTeam).userId, applicant.id);
  assert.equal((await acceptedOnApplicant).userId, applicant.id);

  result = await api(`/teams/${teamId}/suggestions`, { token: applicant.token });
  safeStatus('teammate suggestions', result.response, 200);
  assert.equal(result.json.data.teamId, teamId);

  result = await api(`/teams/${teamId}/invites`, {
    token: leader.token, method: 'POST', body: { expiresInHours: 24 },
  });
  safeStatus('invite creation', result.response, 201);
  const inviteId = result.json.data.invite.id;
  const code = result.json.data.invite.code;
  result = await api(`/teams/${teamId}/invites`, { token: leader.token });
  safeStatus('persistent invite list', result.response, 200);
  assert.equal(result.json.data.invites[0].id, inviteId);
  assert.equal(Object.hasOwn(result.json.data.invites[0], 'codeHash'), false);
  assert.equal(Object.hasOwn(result.json.data.invites[0], 'code'), false);

  const joinedOnTeam = nextEvent(leaderSocket, 'team:member_joined');
  const joinedOnInvitee = nextEvent(inviteeSocket, 'team:member_joined');
  result = await api('/teams/invites/redeem', { token: invitee.token, method: 'POST', body: { code } });
  safeStatus('invite redemption', result.response, 200);
  assert.equal((await joinedOnTeam).userId, invitee.id);
  assert.equal((await joinedOnInvitee).userId, invitee.id);

  result = await api('/teams/my', { token: applicant.token });
  safeStatus('current team lookup', result.response, 200);
  assert.equal(result.json.data.teams[0].id, teamId);
  result = await api('/teams/my/requests', { token: applicant.token });
  safeStatus('my pending requests', result.response, 200);
  assert.deepEqual(result.json.data.joinRequests, []);
  result = await api(`/hackathons/${hackathonId}/teams?availableOnly=true`, { token: leader.token });
  safeStatus('open team directory', result.response, 200);
  assert.equal(result.json.data.teams[0].memberCount, 3);

  console.log('LIVE_OK database=raceproof_test registration=3 login=3 team_create=1 join_request=1 accept=1 suggestions=1 invite_create=1 invite_list=1 invite_redeem=1 socket_events=3');
} finally {
  for (const socket of sockets) socket.disconnect();
  if (liveDatabaseVerified) {
    try {
      if (users.length) {
        await pool.query(
          `DELETE FROM audit_logs
           WHERE actor_id = ANY($1::UUID[]) OR ($2::UUID IS NOT NULL AND team_id = $2)`,
          [users, teamId || null],
        );
      }
      if (hackathonId) await pool.query('DELETE FROM hackathons WHERE id = $1', [hackathonId]);
      if (users.length) await pool.query('DELETE FROM users WHERE id = ANY($1::UUID[])', [users]);
    } finally { await pool.end(); }
  }
}
