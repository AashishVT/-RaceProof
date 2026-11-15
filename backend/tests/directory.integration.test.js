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
  const result = await pool.query(
    'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
    ['Directory Integration User', `directory.${randomUUID()}@example.com`, 'integration-test-hash'],
  );
  const id = result.rows[0].id;
  users.push(id);
  return { id, token: tokenFor(id) };
}

async function createHackathon({ name = `Directory ${randomUUID()}`, maxTeamSize = 5 } = {}) {
  const result = await pool.query(
    `INSERT INTO hackathons (name, status, min_team_size, max_team_size)
     VALUES ($1, 'active', 1, $2) RETURNING id`,
    [name, maxTeamSize],
  );
  hackathons.push(result.rows[0].id);
  return result.rows[0].id;
}

async function createTeam(leader, hackathonId, teamName) {
  const response = await request(app).post('/api/teams')
    .set('Authorization', `Bearer ${leader.token}`)
    .send({ hackathonId, teamName });
  if (response.status === 201) teams.push(response.body.data.team.id);
  return response;
}

function authorized(user, action) {
  return action.set('Authorization', `Bearer ${user.token}`);
}

describe('PostgreSQL-backed hackathon, personal team, and invite directory APIs', () => {
  beforeAll(async () => {
    if (env.nodeEnv !== 'test' || env.databaseName !== 'raceproof_test' || !/_test$/i.test(env.databaseName)) {
      throw new Error('Directory integration tests require raceproof_test.');
    }
    const result = await pool.query('SELECT current_database() AS name');
    if (result.rows[0].name !== 'raceproof_test') {
      throw new Error('Connected database is not raceproof_test; no directory fixtures were written.');
    }
    databaseReady = true;
  }, 30000);

  afterAll(async () => {
    try {
      if (databaseReady) {
        if (users.length) {
          await pool.query(
            `DELETE FROM audit_logs
             WHERE actor_id = ANY($1::UUID[]) OR team_id = ANY($2::UUID[])
                OR metadata->>'teamId' = ANY($3::TEXT[])`,
            [users, teams, teams],
          );
        }
        if (hackathons.length) await pool.query('DELETE FROM hackathons WHERE id = ANY($1::UUID[])', [hackathons]);
        if (users.length) await pool.query('DELETE FROM users WHERE id = ANY($1::UUID[])', [users]);
      }
    } finally { await pool.end(); }
  }, 30000);

  test('lists searchable paginated hackathons and available teams without private fields', async () => {
    const leader = await createUser();
    const openLeader = await createUser();
    const fullMember = await createUser();
    const hackathonId = await createHackathon({ name: `Directory Search ${randomUUID()}`, maxTeamSize: 2 });
    await createHackathon({ name: `Directory Search ${randomUUID()}` });
    const full = await createTeam(leader, hackathonId, 'Full Signal Team');
    const fullJoin = await authorized(fullMember, request(app).post(`/api/teams/${full.body.data.team.id}/join-requests`).send({}));
    const accepted = await authorized(leader, request(app).post(`/api/teams/${full.body.data.team.id}/join-requests/${fullJoin.body.data.joinRequest.id}/accept`).send({}));
    const open = await createTeam(openLeader, hackathonId, 'Open Signal Team');
    expect(full.status).toBe(201);
    expect(fullJoin.status).toBe(201);
    expect(accepted.status).toBe(200);
    expect(open.status).toBe(201);

    const unauthenticated = await request(app).get('/api/hackathons');
    expect(unauthenticated.status).toBe(401);

    const listed = await authorized(leader, request(app).get(`/api/hackathons?q=${encodeURIComponent('Directory Search')}&status=active&page=1&pageSize=1`));
    expect(listed.status).toBe(200);
    expect(listed.body.data.hackathons).toHaveLength(1);
    expect(listed.body.data.hackathons[0]).toMatchObject({ id: hackathonId, status: 'active', maxTeamSize: 2 });
    expect(listed.body.data.pagination).toMatchObject({ page: 1, pageSize: 1, total: 2, totalPages: 2 });

    const detail = await authorized(leader, request(app).get(`/api/hackathons/${hackathonId}`));
    expect(detail.body.data.hackathon).toMatchObject({ id: hackathonId, name: expect.stringContaining('Directory Search') });

    const directory = await authorized(leader, request(app).get(`/api/hackathons/${hackathonId}/teams?availableOnly=true&q=Open`));
    expect(directory.status).toBe(200);
    expect(directory.body.data.teams).toHaveLength(1);
    expect(directory.body.data.teams[0]).toMatchObject({
      id: open.body.data.team.id,
      teamName: 'Open Signal Team',
      memberCount: 1,
      seatsAvailable: 1,
    });
    expect(directory.body.data.teams[0]).not.toHaveProperty('email');
    expect(directory.body.data.teams[0]).not.toHaveProperty('passwordHash');

    const emptyPage = await authorized(leader, request(app).get(`/api/hackathons/${hackathonId}/teams?availableOnly=true&q=Open&page=2&pageSize=1`));
    expect(emptyPage.status).toBe(200);
    expect(emptyPage.body.data.teams).toEqual([]);
    expect(emptyPage.body.data.pagination).toMatchObject({ page: 2, pageSize: 1, total: 1, totalPages: 1 });

    const missingDirectory = await authorized(leader, request(app).get(`/api/hackathons/${randomUUID()}/teams`));
    expect(missingDirectory.status).toBe(404);

    const invalidPagination = await authorized(leader, request(app).get('/api/hackathons?pageSize=1000'));
    expect(invalidPagination.status).toBe(400);
    const missing = await authorized(leader, request(app).get(`/api/hackathons/${randomUUID()}`));
    expect(missing.status).toBe(404);
    expect(directory.body.data.pagination.total).toBe(1);
  }, 30000);

  test('returns only the caller’s teams and pending join requests', async () => {
    const leader = await createUser();
    const applicant = await createUser();
    const otherApplicant = await createUser();
    const hackathonId = await createHackathon();
    const created = await createTeam(leader, hackathonId, 'Personal View Team');
    const teamId = created.body.data.team.id;
    const firstRequest = await authorized(applicant, request(app).post(`/api/teams/${teamId}/join-requests`).send({}));
    const secondRequest = await authorized(otherApplicant, request(app).post(`/api/teams/${teamId}/join-requests`).send({}));
    expect(firstRequest.status).toBe(201);
    expect(secondRequest.status).toBe(201);

    const myTeamsBefore = await authorized(applicant, request(app).get('/api/teams/my'));
    expect(myTeamsBefore.status).toBe(200);
    expect(myTeamsBefore.body.data.teams).toEqual([]);
    const myRequestsBefore = await authorized(applicant, request(app).get('/api/teams/my/requests?page=1&pageSize=1'));
    expect(myRequestsBefore.body.data.joinRequests).toHaveLength(1);
    expect(myRequestsBefore.body.data.pagination).toMatchObject({ page: 1, pageSize: 1, total: 1 });
    expect(myRequestsBefore.body.data.joinRequests[0]).toMatchObject({
      teamId, teamName: 'Personal View Team', hackathonId, status: 'pending',
    });
    expect(myRequestsBefore.body.data.joinRequests[0]).not.toHaveProperty('userEmail');

    const accepted = await authorized(leader, request(app).post(`/api/teams/${teamId}/join-requests/${firstRequest.body.data.joinRequest.id}/accept`).send({}));
    expect(accepted.status).toBe(200);
    const myTeamsAfter = await authorized(applicant, request(app).get('/api/teams/my'));
    expect(myTeamsAfter.body.data.teams).toHaveLength(1);
    expect(myTeamsAfter.body.data.teams[0]).toMatchObject({ id: teamId, userRole: 'member', memberCount: 2 });
    expect(myTeamsAfter.body.data.teams[0].members.map((member) => member.userId)).toContain(applicant.id);
    expect((await authorized(applicant, request(app).get('/api/teams/my/requests'))).body.data.joinRequests).toEqual([]);

    const invalid = await authorized(applicant, request(app).get('/api/teams/my/requests?page=0'));
    expect(invalid.status).toBe(400);
    expect((await request(app).get('/api/teams/my')).status).toBe(401);
  }, 30000);

  test('lists invite metadata only for team leaders and never returns stored hashes or codes', async () => {
    const leader = await createUser();
    const outsider = await createUser();
    const hackathonId = await createHackathon();
    const createdTeam = await createTeam(leader, hackathonId, 'Invite Listing Team');
    const teamId = createdTeam.body.data.team.id;
    const createdInvite = await authorized(leader, request(app).post(`/api/teams/${teamId}/invites`).send({ expiresInHours: 24 }));
    expect(createdInvite.status).toBe(201);

    const listed = await authorized(leader, request(app).get(`/api/teams/${teamId}/invites`));
    expect(listed.status).toBe(200);
    expect(listed.body.data.invites).toHaveLength(1);
    expect(listed.body.data.invites[0]).toMatchObject({
      id: createdInvite.body.data.invite.id,
      teamId,
      isActive: true,
      isExpired: false,
    });
    expect(listed.body.data.invites[0]).not.toHaveProperty('code');
    expect(listed.body.data.invites[0]).not.toHaveProperty('codeHash');
    expect(JSON.stringify(listed.body.data.invites)).not.toContain(createdInvite.body.data.invite.code);

    const denied = await authorized(outsider, request(app).get(`/api/teams/${teamId}/invites`));
    expect(denied.status).toBe(403);
    const revoked = await authorized(leader, request(app).delete(`/api/teams/${teamId}/invites/${createdInvite.body.data.invite.id}`));
    expect(revoked.status).toBe(200);
    const afterRevoke = await authorized(leader, request(app).get(`/api/teams/${teamId}/invites`));
    expect(afterRevoke.body.data.invites[0]).toMatchObject({ isActive: false, isExpired: false });
  }, 30000);
});
