const { randomUUID } = require('node:crypto');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const app = require('../src/app');
const env = require('../src/config/env');
const { pool } = require('../src/config/database');

const users = [];
const hackathons = [];
const teams = [];
let databaseReady = false;

function tokenFor(userId) {
  return jwt.sign({ userId }, env.jwtSecret, { expiresIn: '15m' });
}

async function createUser() {
  const email = `team-test.${randomUUID()}@example.com`;
  const result = await pool.query(
    `INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, email`,
    ['Team API Test User', email, 'integration-test-hash'],
  );
  const user = result.rows[0];
  users.push(user.id);
  return { ...user, token: tokenFor(user.id) };
}

async function createHackathon({ status = 'active', minTeamSize = 1, maxTeamSize = 5 } = {}) {
  const result = await pool.query(
    `INSERT INTO hackathons (name, status, min_team_size, max_team_size)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [`Team API Test ${randomUUID()}`, status, minTeamSize, maxTeamSize],
  );
  const hackathonId = result.rows[0].id;
  hackathons.push(hackathonId);
  return hackathonId;
}

async function createTeam(leader, hackathonId, teamName = `Team ${randomUUID()}`, idempotencyKey) {
  let call = request(app).post('/api/teams').set('Authorization', `Bearer ${leader.token}`)
    .send({ hackathonId, teamName });
  if (idempotencyKey) call = call.set('Idempotency-Key', idempotencyKey);
  const response = await call;
  if (response.status === 201) teams.push(response.body.data.team.id);
  return response;
}

async function requestToJoin(user, teamId, idempotencyKey) {
  let call = request(app).post(`/api/teams/${teamId}/join-requests`)
    .set('Authorization', `Bearer ${user.token}`).send({});
  if (idempotencyKey) call = call.set('Idempotency-Key', idempotencyKey);
  return call;
}

async function auth(user, call) {
  return call.set('Authorization', `Bearer ${user.token}`);
}

describe('PostgreSQL-backed team formation API', () => {
  beforeAll(async () => {
    if (env.nodeEnv !== 'test' || env.databaseName !== 'raceproof_test' || !/_test$/i.test(env.databaseName)) {
      throw new Error('Team integration tests require the dedicated raceproof_test database.');
    }
    const result = await pool.query('SELECT current_database() AS name');
    if (result.rows[0].name !== 'raceproof_test') {
      throw new Error('Connected database is not raceproof_test; no team test data was written.');
    }
    const leaderConstraint = await pool.query(
      `SELECT COUNT(*)::INTEGER AS count
       FROM pg_constraint
       WHERE conname = 'teams_leader_role_member_fk' AND conrelid = 'teams'::REGCLASS`,
    );
    if (leaderConstraint.rows[0].count !== 1) {
      throw new Error('Migration 003 is required before team integration tests.');
    }
    databaseReady = true;
  }, 30000);

  afterAll(async () => {
    try {
      if (databaseReady) {
        if (users.length) {
          await pool.query(
            `DELETE FROM audit_logs
             WHERE actor_id = ANY($1::UUID[])
                OR team_id = ANY($2::UUID[])
                OR metadata->>'teamId' = ANY($3::TEXT[])`,
            [users, teams, teams],
          );
        }
        if (hackathons.length) {
          await pool.query('DELETE FROM hackathons WHERE id = ANY($1::UUID[])', [hackathons]);
        }
        if (users.length) {
          await pool.query('DELETE FROM users WHERE id = ANY($1::UUID[])', [users]);
        }
      }
    } finally {
      await pool.end();
    }
  }, 30000);

  test('requires authentication and validates team creation input', async () => {
    const hackathonId = await createHackathon();
    const unauthenticated = await request(app).post('/api/teams').send({ hackathonId, teamName: 'Valid Team' });
    expect(unauthenticated.status).toBe(401);

    const leader = await createUser();
    const invalidName = await auth(leader, request(app).post('/api/teams').send({ hackathonId, teamName: ' ' }));
    expect(invalidName.status).toBe(400);
    const invalidHackathon = await auth(leader, request(app).post('/api/teams').send({ hackathonId: randomUUID(), teamName: 'Valid Team' }));
    expect(invalidHackathon.status).toBe(404);
  });

  test('creates a team and its leader atomically and records an audit event', async () => {
    const leader = await createUser();
    const hackathonId = await createHackathon({ minTeamSize: 2, maxTeamSize: 4 });
    const response = await createTeam(leader, hackathonId, 'Atomic Team');

    expect(response.status).toBe(201);
    expect(response.body.data.team).toMatchObject({
      teamName: 'Atomic Team', leaderId: leader.id, minTeamSize: 2, maxTeamSize: 4,
      memberCount: 1,
    });
    expect(response.body.data.team.members[0]).toMatchObject({ userId: leader.id, role: 'leader' });

    const persisted = await pool.query(
      `SELECT t.leader_id, tm.role
       FROM teams t JOIN team_members tm ON tm.team_id = t.id AND tm.user_id = t.leader_id
       WHERE t.id = $1`,
      [response.body.data.team.id],
    );
    expect(persisted.rows).toEqual([{ leader_id: leader.id, role: 'leader' }]);
    const audit = await pool.query(
      `SELECT action FROM audit_logs WHERE team_id = $1 AND actor_id = $2`,
      [response.body.data.team.id, leader.id],
    );
    expect(audit.rows.map((row) => row.action)).toContain('team.created');
  });

  test('rejects duplicate team names within one hackathon', async () => {
    const leader = await createUser();
    const hackathonId = await createHackathon();
    expect((await createTeam(leader, hackathonId, 'Unique Name')).status).toBe(201);
    expect((await createTeam(leader, hackathonId, 'Unique Name')).status).toBe(409);
  });

  test('returns team details and reports unknown teams', async () => {
    const leader = await createUser();
    const hackathonId = await createHackathon();
    const created = await createTeam(leader, hackathonId);
    const details = await auth(leader, request(app).get(`/api/teams/${created.body.data.team.id}`));
    const missing = await auth(leader, request(app).get(`/api/teams/${randomUUID()}`));

    expect(details.status).toBe(200);
    expect(details.body.data.team.members).toHaveLength(1);
    expect(missing.status).toBe(404);
  });

  test('creates one pending join request and lists it only for the leader', async () => {
    const leader = await createUser();
    const applicant = await createUser();
    const outsider = await createUser();
    const hackathonId = await createHackathon();
    const team = await createTeam(leader, hackathonId);
    const teamId = team.body.data.team.id;

    const created = await requestToJoin(applicant, teamId);
    const duplicate = await requestToJoin(applicant, teamId);
    const listed = await auth(leader, request(app).get(`/api/teams/${teamId}/join-requests`));
    const forbidden = await auth(outsider, request(app).get(`/api/teams/${teamId}/join-requests`));

    expect(created.status).toBe(201);
    expect(duplicate.status).toBe(409);
    expect(listed.status).toBe(200);
    expect(listed.body.data.joinRequests).toHaveLength(1);
    expect(listed.body.data.joinRequests[0].userId).toBe(applicant.id);
    expect(forbidden.status).toBe(403);
    const audits = await pool.query(
      `SELECT action FROM audit_logs WHERE team_id = $1 AND actor_id = $2`,
      [teamId, applicant.id],
    );
    expect(audits.rows.map((row) => row.action)).toContain('join_request.created');
  });

  test('requires an active hackathon and available capacity for join requests', async () => {
    const leader = await createUser();
    const applicant = await createUser();
    const inactiveId = await createHackathon({ status: 'upcoming', maxTeamSize: 3 });
    const inactiveTeam = await createTeam(leader, inactiveId);
    const inactiveRequest = await requestToJoin(applicant, inactiveTeam.body.data.team.id);
    expect(inactiveRequest.status).toBe(409);

    const fullLeader = await createUser();
    const fullHackathon = await createHackathon({ maxTeamSize: 1 });
    const fullTeam = await createTeam(fullLeader, fullHackathon);
    const fullRequest = await requestToJoin(applicant, fullTeam.body.data.team.id);
    expect(fullRequest.status).toBe(409);
  });

  test('does not allow users already in the hackathon to request another team', async () => {
    const firstLeader = await createUser();
    const secondLeader = await createUser();
    const applicant = await createUser();
    const hackathonId = await createHackathon();
    const firstTeam = await createTeam(firstLeader, hackathonId);
    const secondTeam = await createTeam(secondLeader, hackathonId);
    const joined = await requestToJoin(applicant, firstTeam.body.data.team.id);
    const accepted = await auth(firstLeader, request(app)
      .post(`/api/teams/${firstTeam.body.data.team.id}/join-requests/${joined.body.data.joinRequest.id}/accept`).send({}));
    const secondRequest = await requestToJoin(applicant, secondTeam.body.data.team.id);

    expect(accepted.status).toBe(200);
    expect(secondRequest.status).toBe(409);
  });

  test('accepts a pending request atomically and records membership and audit data', async () => {
    const leader = await createUser();
    const applicant = await createUser();
    const hackathonId = await createHackathon();
    const team = await createTeam(leader, hackathonId);
    const teamId = team.body.data.team.id;
    const join = await requestToJoin(applicant, teamId);
    const accepted = await auth(leader, request(app)
      .post(`/api/teams/${teamId}/join-requests/${join.body.data.joinRequest.id}/accept`).send({}));

    expect(accepted.status).toBe(200);
    expect(accepted.body.data.joinRequest.status).toBe('accepted');
    expect(accepted.body.data.member.userId).toBe(applicant.id);
    const state = await pool.query(
      `SELECT (SELECT COUNT(*) FROM team_members WHERE team_id = $1)::INTEGER AS member_count,
              (SELECT status FROM join_requests WHERE id = $2) AS request_status,
              (SELECT COUNT(*) FROM audit_logs WHERE team_id = $1 AND action = 'join_request.accepted')::INTEGER AS accepted_audits`,
      [teamId, join.body.data.joinRequest.id],
    );
    expect(state.rows[0]).toEqual({ member_count: 2, request_status: 'accepted', accepted_audits: 1 });
  });

  test('only the leader can accept or decline, and decline is audited', async () => {
    const leader = await createUser();
    const applicant = await createUser();
    const outsider = await createUser();
    const hackathonId = await createHackathon();
    const team = await createTeam(leader, hackathonId);
    const teamId = team.body.data.team.id;
    const join = await requestToJoin(applicant, teamId);
    const requestId = join.body.data.joinRequest.id;

    const denied = await auth(outsider, request(app).post(`/api/teams/${teamId}/join-requests/${requestId}/accept`).send({}));
    const declined = await auth(leader, request(app).post(`/api/teams/${teamId}/join-requests/${requestId}/decline`).send({}));
    const duplicateDecision = await auth(leader, request(app).post(`/api/teams/${teamId}/join-requests/${requestId}/decline`).send({}));

    expect(denied.status).toBe(403);
    expect(declined.status).toBe(200);
    expect(declined.body.data.joinRequest.status).toBe('rejected');
    expect(duplicateDecision.status).toBe(409);
    const audit = await pool.query(
      `SELECT COUNT(*)::INTEGER AS count FROM audit_logs WHERE team_id = $1 AND action = 'join_request.rejected'`,
      [teamId],
    );
    expect(audit.rows[0].count).toBe(1);
  });

  test('rejects acceptance when the team became full and leaves the request pending', async () => {
    const leader = await createUser();
    const applicant = await createUser();
    const hackathonId = await createHackathon({ maxTeamSize: 1 });
    const team = await createTeam(leader, hackathonId);
    const teamId = team.body.data.team.id;
    const join = await pool.query(
      `INSERT INTO join_requests (team_id, user_id) VALUES ($1, $2) RETURNING id`,
      [teamId, applicant.id],
    );
    const result = await auth(leader, request(app)
      .post(`/api/teams/${teamId}/join-requests/${join.rows[0].id}/accept`).send({}));

    expect(result.status).toBe(409);
    const status = await pool.query(
      `SELECT jr.status, COUNT(tm.user_id)::INTEGER AS member_count
       FROM join_requests jr LEFT JOIN team_members tm ON tm.team_id = jr.team_id
       WHERE jr.id = $1 GROUP BY jr.status`,
      [join.rows[0].id],
    );
    expect(status.rows[0]).toEqual({ status: 'pending', member_count: 1 });
  });

  test('allows only the leader to remove non-leader members and audits the removal', async () => {
    const leader = await createUser();
    const member = await createUser();
    const outsider = await createUser();
    const hackathonId = await createHackathon();
    const team = await createTeam(leader, hackathonId);
    const teamId = team.body.data.team.id;
    const join = await requestToJoin(member, teamId);
    await auth(leader, request(app).post(`/api/teams/${teamId}/join-requests/${join.body.data.joinRequest.id}/accept`).send({}));

    const denied = await auth(outsider, request(app).delete(`/api/teams/${teamId}/members/${member.id}`));
    const removed = await auth(leader, request(app).delete(`/api/teams/${teamId}/members/${member.id}`));
    expect(denied.status).toBe(403);
    expect(removed.status).toBe(200);
    const state = await pool.query('SELECT COUNT(*)::INTEGER AS members FROM team_members WHERE team_id = $1', [teamId]);
    expect(state.rows[0].members).toBe(1);
    const audit = await pool.query(`SELECT COUNT(*)::INTEGER AS count FROM audit_logs WHERE team_id = $1 AND action = 'member.removed'`, [teamId]);
    expect(audit.rows[0].count).toBe(1);
  });

  test('prevents removing the leader through the member-removal endpoint', async () => {
    const leader = await createUser();
    const team = await createTeam(leader, await createHackathon());
    const result = await auth(leader, request(app).delete(`/api/teams/${team.body.data.team.id}/members/${leader.id}`));
    expect(result.status).toBe(409);
  });

  test('allows a member to leave without changing leadership', async () => {
    const leader = await createUser();
    const member = await createUser();
    const team = await createTeam(leader, await createHackathon());
    const teamId = team.body.data.team.id;
    const join = await requestToJoin(member, teamId);
    await auth(leader, request(app).post(`/api/teams/${teamId}/join-requests/${join.body.data.joinRequest.id}/accept`).send({}));

    const left = await auth(member, request(app).delete(`/api/teams/${teamId}/leave`));
    const details = await auth(leader, request(app).get(`/api/teams/${teamId}`));
    expect(left.status).toBe(200);
    expect(details.body.data.team.leaderId).toBe(leader.id);
    expect(details.body.data.team.members.map((entry) => entry.userId)).toEqual([leader.id]);
    const audit = await pool.query(`SELECT COUNT(*)::INTEGER AS count FROM audit_logs WHERE team_id = $1 AND action = 'member.left'`, [teamId]);
    expect(audit.rows[0].count).toBe(1);
  });

  test('transfers leadership to the oldest remaining member when the leader leaves', async () => {
    const leader = await createUser();
    const firstMember = await createUser();
    const secondMember = await createUser();
    const team = await createTeam(leader, await createHackathon());
    const teamId = team.body.data.team.id;
    for (const member of [firstMember, secondMember]) {
      const join = await requestToJoin(member, teamId);
      const accepted = await auth(leader, request(app).post(`/api/teams/${teamId}/join-requests/${join.body.data.joinRequest.id}/accept`).send({}));
      expect(accepted.status).toBe(200);
    }

    const left = await auth(leader, request(app).delete(`/api/teams/${teamId}/leave`));
    const teamRow = await pool.query(`SELECT leader_id FROM teams WHERE id = $1`, [teamId]);
    const roles = await pool.query(`SELECT user_id, role FROM team_members WHERE team_id = $1 ORDER BY role`, [teamId]);
    const audits = await pool.query(`SELECT action, metadata FROM audit_logs WHERE team_id = $1 AND action = 'leadership.transferred'`, [teamId]);

    expect(left.status).toBe(200);
    expect(teamRow.rows[0].leader_id).toBe(firstMember.id);
    expect(roles.rows).toContainEqual({ user_id: firstMember.id, role: 'leader' });
    expect(roles.rows).toContainEqual({ user_id: secondMember.id, role: 'member' });
    expect(audits.rows).toHaveLength(1);
    expect(audits.rows[0].metadata).toMatchObject({ fromUserId: leader.id, toUserId: firstMember.id });
  }, 30000);

  test('deletes an empty team when its last member leaves and preserves the audit', async () => {
    const leader = await createUser();
    const team = await createTeam(leader, await createHackathon());
    const teamId = team.body.data.team.id;
    const left = await auth(leader, request(app).delete(`/api/teams/${teamId}/leave`));
    const missing = await pool.query('SELECT 1 FROM teams WHERE id = $1', [teamId]);
    const audit = await pool.query(
      `SELECT action, metadata FROM audit_logs WHERE actor_id = $1 AND action = 'team.deleted'`,
      [leader.id],
    );
    expect(left.status).toBe(200);
    expect(left.body.data.deleted).toBe(true);
    expect(missing.rowCount).toBe(0);
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].metadata.teamId).toBe(teamId);
    const remainingMemberships = await pool.query('SELECT COUNT(*)::INTEGER AS count FROM team_members WHERE team_id = $1', [teamId]);
    expect(remainingMemberships.rows[0].count).toBe(0);
  }, 30000);

  test('replays idempotent team creation and rejects a changed request hash', async () => {
    const leader = await createUser();
    const hackathonId = await createHackathon();
    const key = randomUUID();
    const first = await createTeam(leader, hackathonId, 'Idempotent Team', key);
    const repeated = await createTeam(leader, hackathonId, 'Idempotent Team', key);
    const mismatch = await createTeam(leader, hackathonId, 'Different Team', key);

    expect(first.status).toBe(201);
    expect(repeated.status).toBe(201);
    expect(repeated.body).toEqual(first.body);
    expect(mismatch.status).toBe(409);
    const counts = await pool.query(
      `SELECT COUNT(*)::INTEGER AS teams,
              (SELECT COUNT(*)::INTEGER FROM audit_logs WHERE actor_id = $1 AND action = 'team.created') AS audits
       FROM teams WHERE hackathon_id = $2 AND team_name = 'Idempotent Team'`,
      [leader.id, hackathonId],
    );
    expect(counts.rows[0]).toEqual({ teams: 1, audits: 1 });
  });

  test('serializes concurrent retries with the same idempotency key', async () => {
    const leader = await createUser();
    const hackathonId = await createHackathon();
    const key = randomUUID();
    const results = await Promise.all([
      createTeam(leader, hackathonId, 'Concurrent Idempotent Team', key),
      createTeam(leader, hackathonId, 'Concurrent Idempotent Team', key),
    ]);

    expect(results.map((result) => result.status)).toEqual([201, 201]);
    expect(results[0].body).toEqual(results[1].body);
    const count = await pool.query(`SELECT COUNT(*)::INTEGER AS count FROM teams WHERE hackathon_id = $1 AND team_name = 'Concurrent Idempotent Team'`, [hackathonId]);
    expect(count.rows[0].count).toBe(1);
  });

  test('acceptance idempotency replays the original successful result', async () => {
    const leader = await createUser();
    const applicant = await createUser();
    const team = await createTeam(leader, await createHackathon());
    const teamId = team.body.data.team.id;
    const join = await requestToJoin(applicant, teamId);
    const key = randomUUID();
    const endpoint = `/api/teams/${teamId}/join-requests/${join.body.data.joinRequest.id}/accept`;
    const first = await auth(leader, request(app).post(endpoint).set('Idempotency-Key', key).send({}));
    const repeated = await auth(leader, request(app).post(endpoint).set('Idempotency-Key', key).send({}));

    expect(first.status).toBe(200);
    expect(repeated.status).toBe(200);
    expect(repeated.body).toEqual(first.body);
    const audit = await pool.query(`SELECT COUNT(*)::INTEGER AS count FROM audit_logs WHERE team_id = $1 AND action = 'join_request.accepted'`, [teamId]);
    expect(audit.rows[0].count).toBe(1);
  });

  test('50 concurrent acceptances for one remaining seat admit exactly one member', async () => {
    const leader = await createUser();
    const applicants = [];
    for (let index = 0; index < 50; index += 1) applicants.push(await createUser());
    const team = await createTeam(leader, await createHackathon({ maxTeamSize: 2 }));
    const teamId = team.body.data.team.id;
    const requests = [];
    for (const applicant of applicants) {
      const result = await requestToJoin(applicant, teamId);
      expect(result.status).toBe(201);
      requests.push({ applicant, requestId: result.body.data.joinRequest.id });
    }

    const settledResults = await Promise.allSettled(requests.map(({ requestId }) =>
      auth(leader, request(app).post(`/api/teams/${teamId}/join-requests/${requestId}/accept`).send({})),
    ));
    const results = settledResults.map((result) => {
      if (result.status === 'fulfilled') {
        return { status: result.value.status, body: result.value.body };
      }
      const error = result.reason;
      const message = String(error && error.message || error);
      return {
        status: /timeout/i.test(message) ? 'timeout' : 'other',
        body: { errorName: error && error.name || 'Error', message },
      };
    });
    const statusCounts = results.reduce((counts, result) => {
      const status = String(result.status);
      counts[status] = (counts[status] || 0) + 1;
      return counts;
    }, {});
    if (statusCounts['200'] !== 1 || statusCounts['409'] !== 49) {
      console.error('Unexpected concurrent acceptance response classification:', JSON.stringify(statusCounts));
      console.error('Unexpected concurrent acceptance responses:', JSON.stringify(results));
    }
    const invariants = await pool.query(
      `SELECT
         (SELECT COUNT(*)::INTEGER FROM team_members WHERE team_id = $1) AS member_count,
         (SELECT COUNT(*)::INTEGER FROM team_members WHERE hackathon_id = $2 GROUP BY hackathon_id) AS hackathon_member_count,
         (SELECT COUNT(*)::INTEGER FROM join_requests WHERE team_id = $1 AND status = 'accepted') AS accepted_requests,
         (SELECT COUNT(*)::INTEGER FROM join_requests WHERE team_id = $1 AND status = 'pending') AS pending_requests,
         (SELECT COUNT(*)::INTEGER FROM audit_logs WHERE team_id = $1 AND action = 'join_request.accepted') AS accepted_audits,
         (SELECT COUNT(*)::INTEGER FROM (
            SELECT user_id FROM team_members WHERE hackathon_id = $2 GROUP BY user_id HAVING COUNT(*) > 1
          ) duplicates) AS duplicate_users`,
      [teamId, team.body.data.team.hackathonId],
    );
    expect(statusCounts).toEqual({ '200': 1, '409': 49 });
    expect(invariants.rows[0]).toMatchObject({
      member_count: 2,
      hackathon_member_count: 2,
      accepted_requests: 1,
      pending_requests: 49,
      accepted_audits: 1,
      duplicate_users: 0,
    });
  }, 180000);
});
