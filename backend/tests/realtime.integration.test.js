const http = require('node:http');
const { randomUUID } = require('node:crypto');
const jwt = require('jsonwebtoken');
const { io: socketClient } = require('socket.io-client');
const request = require('supertest');
const app = require('../src/app');
const env = require('../src/config/env');
const { pool } = require('../src/config/database');
const { createSocketServer } = require('../src/realtime/socket-server');
const { teamRoom } = require('../src/realtime/team-events');

const users = [];
const hackathons = [];
const teams = [];
const clients = [];
let databaseReady = false;
let httpServer;
let io;
let serverUrl;

function tokenFor(userId, expiresIn = '15m') {
  return jwt.sign({ userId }, env.jwtSecret, { expiresIn });
}

async function createUser(name = 'Socket Test User') {
  const result = await pool.query(
    'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
    [name, `socket-test.${randomUUID()}@example.com`, 'integration-test-hash'],
  );
  const id = result.rows[0].id;
  users.push(id);
  return { id, token: tokenFor(id) };
}

async function createHackathon(maxTeamSize = 10) {
  const result = await pool.query(
    `INSERT INTO hackathons (name, status, min_team_size, max_team_size)
     VALUES ($1, 'active', 1, $2) RETURNING id`,
    [`Socket Test Hackathon ${randomUUID()}`, maxTeamSize],
  );
  hackathons.push(result.rows[0].id);
  return result.rows[0].id;
}

async function createTeam(leader, hackathonId, name = `Socket Team ${randomUUID()}`, key) {
  let call = request(app).post('/api/teams')
    .set('Authorization', `Bearer ${leader.token}`)
    .send({ hackathonId, teamName: name });
  if (key) call = call.set('Idempotency-Key', key);
  const result = await call;
  if (result.status === 201) teams.push(result.body.data.team.id);
  return result;
}

function connect(token) {
  const socket = socketClient(serverUrl, {
    auth: { token },
    transports: ['websocket'],
    reconnection: false,
    timeout: 5000,
  });
  clients.push(socket);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Socket connection timed out.')), 7000);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('connect_error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function connectError(token) {
  const socket = socketClient(serverUrl, {
    auth: { token },
    transports: ['websocket'],
    reconnection: false,
    timeout: 5000,
  });
  clients.push(socket);
  return new Promise((resolve, reject) => {
    socket.once('connect', () => reject(new Error('Invalid token unexpectedly connected.')));
    socket.once('connect_error', resolve);
  });
}

function subscribe(socket, teamId) {
  return new Promise((resolve, reject) => {
    socket.timeout(5000).emit('team:subscribe', { teamId }, (error, result) => {
      if (error) return reject(error);
      return resolve(result);
    });
  });
}

function emitRequest(socket, eventName, payload) {
  return new Promise((resolve, reject) => {
    socket.timeout(5000).emit(eventName, payload, (error, result) => {
      if (error) return reject(error);
      return resolve(result);
    });
  });
}

function nextEvent(socket, eventName, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(eventName, listener);
      reject(new Error(`Timed out waiting for ${eventName}.`));
    }, timeoutMs);
    const listener = (payload) => {
      clearTimeout(timer);
      resolve(payload);
    };
    socket.once(eventName, listener);
  });
}

async function expectNoEvent(socket, eventName, durationMs = 150) {
  let received = false;
  const listener = () => { received = true; };
  socket.on(eventName, listener);
  await new Promise((resolve) => setTimeout(resolve, durationMs));
  socket.off(eventName, listener);
  expect(received).toBe(false);
}

describe('Socket.IO team realtime integration', () => {
  beforeAll(async () => {
    if (env.nodeEnv !== 'test' || env.databaseName !== 'raceproof_test' || !/_test$/i.test(env.databaseName)) {
      throw new Error('Socket integration tests require the dedicated raceproof_test database.');
    }
    const result = await pool.query('SELECT current_database() AS name');
    if (result.rows[0].name !== 'raceproof_test') {
      throw new Error('Connected database is not raceproof_test; no socket test data was written.');
    }
    databaseReady = true;

    httpServer = http.createServer(app);
    io = createSocketServer(httpServer);
    await new Promise((resolve, reject) => {
      httpServer.once('error', reject);
      httpServer.listen(0, '127.0.0.1', resolve);
    });
    serverUrl = `http://127.0.0.1:${httpServer.address().port}`;
  }, 30000);

  afterAll(async () => {
    try {
      for (const client of clients) client.disconnect();
      if (io) await new Promise((resolve) => io.close(resolve));
      if (httpServer && httpServer.listening) {
        await new Promise((resolve, reject) => httpServer.close((error) => error ? reject(error) : resolve()));
      }

      if (databaseReady) {
        await pool.query('DROP TRIGGER IF EXISTS raceproof_socket_rollback_trigger ON audit_logs');
        await pool.query('DROP FUNCTION IF EXISTS public.raceproof_socket_rollback_fn()');
        if (users.length) {
          await pool.query(
            `DELETE FROM audit_logs
             WHERE actor_id = ANY($1::UUID[])
                OR team_id = ANY($2::UUID[])
                OR metadata->>'teamId' = ANY($3::TEXT[])`,
            [users, teams, teams],
          );
        }
        if (hackathons.length) await pool.query('DELETE FROM hackathons WHERE id = ANY($1::UUID[])', [hackathons]);
        if (users.length) await pool.query('DELETE FROM users WHERE id = ANY($1::UUID[])', [users]);
      }
    } finally {
      await pool.end();
    }
  }, 30000);

  test('authenticates valid JWTs and rejects invalid and expired tokens', async () => {
    const user = await createUser();
    const connected = await connect(user.token);
    expect(connected.connected).toBe(true);

    const invalid = await connectError('not-a-valid-jwt');
    const expired = await connectError(tokenFor(user.id, '-1s'));
    expect(invalid.message).toBe('Unauthorized');
    expect(expired.message).toBe('Unauthorized');
  });

  test('authorizes team rooms by membership and disconnects/reconnects without stale room access', async () => {
    const leader = await createUser();
    const outsider = await createUser();
    const team = await createTeam(leader, await createHackathon());
    const teamId = team.body.data.team.id;
    const leaderSocket = await connect(leader.token);
    const outsiderSocket = await connect(outsider.token);

    expect(await subscribe(leaderSocket, teamId)).toMatchObject({ success: true, teamId });
    expect(await subscribe(outsiderSocket, teamId)).toEqual({ success: false, message: 'Team membership is required.' });
    expect(await subscribe(outsiderSocket, 'not-a-uuid')).toEqual({ success: false, message: 'Invalid team room.' });
    expect(io.sockets.adapter.rooms.get(teamRoom(teamId)).has(outsiderSocket.id)).toBe(false);

    leaderSocket.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(io.sockets.adapter.rooms.get(teamRoom(teamId))?.has(leaderSocket.id)).not.toBe(true);

    const reconnected = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Socket reconnect timed out.')), 7000);
      leaderSocket.once('connect', () => {
        clearTimeout(timer);
        resolve();
      });
      leaderSocket.once('connect_error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    leaderSocket.connect();
    await reconnected;
    expect(io.sockets.adapter.rooms.get(teamRoom(teamId))?.has(leaderSocket.id)).not.toBe(true);
    expect(await subscribe(leaderSocket, teamId)).toMatchObject({ success: true, teamId });
  }, 30000);

  test('team creation events are post-commit and idempotent retries emit once', async () => {
    const leader = await createUser();
    const hackathonId = await createHackathon();
    const leaderSocket = await connect(leader.token);
    const createdEvent = nextEvent(leaderSocket, 'team:created');
    const idempotencyKey = randomUUID();
    const first = await createTeam(leader, hackathonId, 'Realtime Idempotent Team', idempotencyKey);
    const event = await createdEvent;
    const repeated = await createTeam(leader, hackathonId, 'Realtime Idempotent Team', idempotencyKey);

    expect(first.status).toBe(201);
    expect(repeated.status).toBe(201);
    expect(event).toMatchObject({
      teamId: first.body.data.team.id,
      hackathonId,
      teamName: 'Realtime Idempotent Team',
      leaderId: leader.id,
    });
    expect(event).not.toHaveProperty('email');
    expect(event).not.toHaveProperty('password');
    await expectNoEvent(leaderSocket, 'team:created');
    const persisted = await pool.query('SELECT 1 FROM teams WHERE id = $1', [event.teamId]);
    expect(persisted.rowCount).toBe(1);
  }, 30000);

  test('publishes team events for requests, decisions, invite redemption/revocation, removal, and leadership transfer', async () => {
    const leader = await createUser('Realtime Leader');
    const applicant = await createUser('Realtime Applicant');
    const declinedApplicant = await createUser('Declined Applicant');
    const invitee = await createUser('Invitee');
    const hackathonId = await createHackathon(6);
    const created = await createTeam(leader, hackathonId);
    const teamId = created.body.data.team.id;
    const leaderSocket = await connect(leader.token);
    const applicantSocket = await connect(applicant.token);
    const declinedSocket = await connect(declinedApplicant.token);
    const inviteeSocket = await connect(invitee.token);
    await subscribe(leaderSocket, teamId);

    const requestCreated = nextEvent(leaderSocket, 'team:join_request_created');
    const join = await request(app).post(`/api/teams/${teamId}/join-requests`)
      .set('Authorization', `Bearer ${applicant.token}`).send({});
    expect(join.status).toBe(201);
    expect(await requestCreated).toMatchObject({ teamId, requesterId: applicant.id });

    const acceptedOnTeam = nextEvent(leaderSocket, 'team:join_request_accepted');
    const acceptedForUser = nextEvent(applicantSocket, 'team:join_request_accepted');
    const accepted = await request(app).post(`/api/teams/${teamId}/join-requests/${join.body.data.joinRequest.id}/accept`)
      .set('Authorization', `Bearer ${leader.token}`).send({});
    expect(accepted.status).toBe(200);
    expect(await acceptedOnTeam).toMatchObject({ teamId, userId: applicant.id });
    expect(await acceptedForUser).toMatchObject({ teamId, userId: applicant.id });
    const acceptedAudit = await pool.query(
      `SELECT COUNT(*)::INTEGER AS count FROM audit_logs WHERE team_id = $1 AND action = 'join_request.accepted'`,
      [teamId],
    );
    expect(acceptedAudit.rows[0].count).toBe(1);

    const secondJoin = await request(app).post(`/api/teams/${teamId}/join-requests`)
      .set('Authorization', `Bearer ${declinedApplicant.token}`).send({});
    const declinedForUser = nextEvent(declinedSocket, 'team:join_request_declined');
    const declined = await request(app).post(`/api/teams/${teamId}/join-requests/${secondJoin.body.data.joinRequest.id}/decline`)
      .set('Authorization', `Bearer ${leader.token}`).send({});
    expect(declined.status).toBe(200);
    expect(await declinedForUser).toMatchObject({ teamId, userId: declinedApplicant.id });

    const invite = await request(app).post(`/api/teams/${teamId}/invites`)
      .set('Authorization', `Bearer ${leader.token}`).send({ expiresInHours: 1 });
    const joinedOnTeam = nextEvent(leaderSocket, 'team:member_joined');
    const joinedForUser = nextEvent(inviteeSocket, 'team:member_joined');
    const redemption = await request(app).post('/api/teams/invites/redeem')
      .set('Authorization', `Bearer ${invitee.token}`).send({ code: invite.body.data.invite.code });
    expect(redemption.status).toBe(200);
    expect(await joinedOnTeam).toMatchObject({ teamId, userId: invitee.id, source: 'invite' });
    expect(await joinedForUser).toMatchObject({ teamId, userId: invitee.id, source: 'invite' });

    const secondInvite = await request(app).post(`/api/teams/${teamId}/invites`)
      .set('Authorization', `Bearer ${leader.token}`).send({});
    const revokedEvent = nextEvent(leaderSocket, 'team:invite_revoked');
    const revoked = await request(app).delete(`/api/teams/${teamId}/invites/${secondInvite.body.data.invite.id}`)
      .set('Authorization', `Bearer ${leader.token}`);
    expect(revoked.status).toBe(200);
    expect(await revokedEvent).toEqual({ teamId, inviteId: secondInvite.body.data.invite.id });
    expect(revokedEvent).not.toHaveProperty('code');

    const inviteeMembership = await subscribe(inviteeSocket, teamId);
    expect(inviteeMembership.success).toBe(true);
    const removedOnTeam = nextEvent(leaderSocket, 'team:member_removed');
    const removedForUser = nextEvent(inviteeSocket, 'team:member_removed');
    const removed = await request(app).delete(`/api/teams/${teamId}/members/${invitee.id}`)
      .set('Authorization', `Bearer ${leader.token}`);
    expect(removed.status).toBe(200);
    expect(await removedOnTeam).toEqual({ teamId, userId: invitee.id });
    expect(await removedForUser).toEqual({ teamId, userId: invitee.id });
    expect(io.sockets.adapter.rooms.get(teamRoom(teamId))?.has(inviteeSocket.id)).not.toBe(true);

    expect((await subscribe(applicantSocket, teamId)).success).toBe(true);
    const transferOnTeam = nextEvent(applicantSocket, 'team:leadership_transferred');
    const transferForLeader = nextEvent(leaderSocket, 'team:leadership_transferred');
    const leftOnTeam = nextEvent(applicantSocket, 'team:member_left');
    const leftForLeader = nextEvent(leaderSocket, 'team:member_left');
    const left = await request(app).delete(`/api/teams/${teamId}/leave`)
      .set('Authorization', `Bearer ${leader.token}`);
    expect(left.status).toBe(200);
    expect(await transferOnTeam).toMatchObject({ teamId, fromUserId: leader.id, toUserId: applicant.id });
    expect(await transferForLeader).toMatchObject({ teamId, fromUserId: leader.id, toUserId: applicant.id });
    expect(await leftOnTeam).toMatchObject({ teamId, userId: leader.id });
    expect(await leftForLeader).toMatchObject({ teamId, userId: leader.id });
  }, 60000);

  test('does not emit when the database transaction rolls back', async () => {
    const leader = await createUser('Rollback Event Leader');
    const applicant = await createUser('Rollback Event Applicant');
    const team = await createTeam(leader, await createHackathon());
    const teamId = team.body.data.team.id;
    const leaderSocket = await connect(leader.token);
    await subscribe(leaderSocket, teamId);
    let eventReceived = false;
    const listener = () => { eventReceived = true; };
    leaderSocket.on('team:join_request_created', listener);

    await pool.query(`
      CREATE OR REPLACE FUNCTION public.raceproof_socket_rollback_fn()
      RETURNS TRIGGER LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.action = 'join_request.created' THEN
          RAISE EXCEPTION 'socket rollback regression trigger' USING ERRCODE = 'P0001';
        END IF;
        RETURN NEW;
      END;
      $$
    `);
    await pool.query(`CREATE TRIGGER raceproof_socket_rollback_trigger
      BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION public.raceproof_socket_rollback_fn()`);

    try {
      const failed = await request(app).post(`/api/teams/${teamId}/join-requests`)
        .set('Authorization', `Bearer ${applicant.token}`).send({});
      await new Promise((resolve) => setTimeout(resolve, 200));
      leaderSocket.off('team:join_request_created', listener);
      const persisted = await pool.query('SELECT COUNT(*)::INTEGER AS count FROM join_requests WHERE team_id = $1', [teamId]);
      expect(failed.status).toBe(500);
      expect(eventReceived).toBe(false);
      expect(persisted.rows[0].count).toBe(0);
    } finally {
      await pool.query('DROP TRIGGER IF EXISTS raceproof_socket_rollback_trigger ON audit_logs');
      await pool.query('DROP FUNCTION IF EXISTS public.raceproof_socket_rollback_fn()');
    }
  }, 30000);
});
