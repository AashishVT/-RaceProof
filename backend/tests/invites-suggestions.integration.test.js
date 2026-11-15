const { createHash, randomUUID } = require('node:crypto');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const app = require('../src/app');
const env = require('../src/config/env');
const { pool } = require('../src/config/database');
const { rankCandidates } = require('../src/services/suggestions.service');

const users = [];
const hackathons = [];
const teams = [];
let databaseReady = false;

function tokenFor(userId) {
  return jwt.sign({ userId }, env.jwtSecret, { expiresIn: '15m' });
}

async function createUser(name = 'Invite Test User') {
  const result = await pool.query(
    `INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id`,
    [name, `invite-test.${randomUUID()}@example.com`, 'integration-test-hash'],
  );
  const id = result.rows[0].id;
  users.push(id);
  return { id, token: tokenFor(id) };
}

async function setProfile(userId, skills, timeZone = 'UTC') {
  await pool.query('UPDATE users SET skills = $2, time_zone = $3 WHERE id = $1', [userId, skills, timeZone]);
}

async function createHackathon({ status = 'active', maxTeamSize = 10 } = {}) {
  const result = await pool.query(
    `INSERT INTO hackathons (name, status, min_team_size, max_team_size)
     VALUES ($1, $2, 1, $3) RETURNING id`,
    [`Invite Test Hackathon ${randomUUID()}`, status, maxTeamSize],
  );
  hackathons.push(result.rows[0].id);
  return result.rows[0].id;
}

async function createTeam(leader, hackathonId, teamName = `Invite Team ${randomUUID()}`) {
  const result = await request(app)
    .post('/api/teams')
    .set('Authorization', `Bearer ${leader.token}`)
    .send({ hackathonId, teamName });
  if (result.status === 201) teams.push(result.body.data.team.id);
  return result;
}

function as(user, action) {
  return action.set('Authorization', `Bearer ${user.token}`);
}

async function makeInvite(leader, teamId, expiresInHours = 24) {
  return as(leader, request(app).post(`/api/teams/${teamId}/invites`).send({ expiresInHours }));
}

async function redeem(user, code) {
  return as(user, request(app).post('/api/teams/invites/redeem').send({ code }));
}

describe('PostgreSQL-backed invite and teammate suggestion APIs', () => {
  beforeAll(async () => {
    if (env.nodeEnv !== 'test' || env.databaseName !== 'raceproof_test' || !/_test$/i.test(env.databaseName)) {
      throw new Error('Invite and suggestion tests require the dedicated raceproof_test database.');
    }
    const result = await pool.query('SELECT current_database() AS name');
    if (result.rows[0].name !== 'raceproof_test') {
      throw new Error('Connected database is not raceproof_test; no invite test data was written.');
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
        if (hackathons.length) await pool.query('DELETE FROM hackathons WHERE id = ANY($1::UUID[])', [hackathons]);
        if (users.length) await pool.query('DELETE FROM users WHERE id = ANY($1::UUID[])', [users]);
      }
    } finally {
      await pool.end();
    }
  }, 30000);

  test('creates an unpredictable leader-only invite, stores only its hash, and honors expiration input', async () => {
    const leader = await createUser();
    const member = await createUser();
    const outsider = await createUser();
    const team = await createTeam(leader, await createHackathon());
    const teamId = team.body.data.team.id;
    const unauthorized = await makeInvite(outsider, teamId);
    const created = await makeInvite(leader, teamId, 2);

    expect(unauthorized.status).toBe(403);
    expect(created.status).toBe(201);
    const invite = created.body.data.invite;
    expect(invite.code).toEqual(expect.any(String));
    expect(invite.code).toHaveLength(43);
    expect(new Date(invite.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(await makeInvite(leader, teamId, 721).then((result) => result.status)).toBe(400);

    const stored = await pool.query('SELECT code_hash, expires_at FROM invite_codes WHERE id = $1', [invite.id]);
    const expectedHash = createHash('sha256').update(invite.code).digest('hex');
    expect(stored.rows[0].code_hash).toBe(expectedHash);
    expect(stored.rows[0].code_hash).not.toBe(invite.code);
    expect(new Date(stored.rows[0].expires_at).getTime()).toBeGreaterThan(Date.now());
    const audit = await pool.query(`SELECT action FROM audit_logs WHERE team_id = $1 AND action = 'invite.created'`, [teamId]);
    expect(audit.rows).toHaveLength(1);
    expect(member.id).toBeDefined();
  });

  test('redeems valid codes, records redemption, and prevents the same member joining twice', async () => {
    const leader = await createUser();
    const first = await createUser();
    const second = await createUser();
    const team = await createTeam(leader, await createHackathon({ maxTeamSize: 3 }));
    const teamId = team.body.data.team.id;
    const invite = await makeInvite(leader, teamId);

    const redeemed = await redeem(first, invite.body.data.invite.code);
    const reusedBySameUser = await redeem(first, invite.body.data.invite.code);
    const reusedByAnotherUser = await redeem(second, invite.body.data.invite.code);

    expect(redeemed.status).toBe(200);
    expect(reusedBySameUser.status).toBe(409);
    expect(reusedByAnotherUser.status).toBe(200);
    const members = await pool.query('SELECT COUNT(*)::INTEGER AS count FROM team_members WHERE team_id = $1', [teamId]);
    const audits = await pool.query(`SELECT COUNT(*)::INTEGER AS count FROM audit_logs WHERE team_id = $1 AND action = 'invite.redeemed'`, [teamId]);
    expect(members.rows[0].count).toBe(3);
    expect(audits.rows[0].count).toBe(2);
  });

  test('returns the same generic response for invalid, expired, and revoked codes', async () => {
    const leader = await createUser();
    const applicant = await createUser();
    const team = await createTeam(leader, await createHackathon());
    const teamId = team.body.data.team.id;
    const expired = await makeInvite(leader, teamId);
    await pool.query('UPDATE invite_codes SET expires_at = NOW() - INTERVAL \'1 second\' WHERE id = $1', [expired.body.data.invite.id]);
    const revoked = await makeInvite(leader, teamId);
    await as(leader, request(app).delete(`/api/teams/${teamId}/invites/${revoked.body.data.invite.id}`));

    const invalidResult = await redeem(applicant, 'unrecognized-code');
    const expiredResult = await redeem(applicant, expired.body.data.invite.code);
    const revokedResult = await redeem(applicant, revoked.body.data.invite.code);
    expect([invalidResult.status, expiredResult.status, revokedResult.status]).toEqual([404, 404, 404]);
    expect(invalidResult.body).toEqual(expiredResult.body);
    expect(expiredResult.body).toEqual(revokedResult.body);
    expect(invalidResult.body.message).toBe('Invite code is invalid or unavailable.');
  }, 30000);

  test('revokes codes only for the leader and records the revocation', async () => {
    const leader = await createUser();
    const outsider = await createUser();
    const team = await createTeam(leader, await createHackathon());
    const teamId = team.body.data.team.id;
    const invite = await makeInvite(leader, teamId);
    const inviteId = invite.body.data.invite.id;

    const forbidden = await as(outsider, request(app).delete(`/api/teams/${teamId}/invites/${inviteId}`));
    const revoked = await as(leader, request(app).delete(`/api/teams/${teamId}/invites/${inviteId}`));
    const repeated = await as(leader, request(app).delete(`/api/teams/${teamId}/invites/${inviteId}`));
    const stored = await pool.query('SELECT is_active FROM invite_codes WHERE id = $1', [inviteId]);
    const audits = await pool.query(`SELECT COUNT(*)::INTEGER AS count FROM audit_logs WHERE team_id = $1 AND action = 'invite.revoked'`, [teamId]);

    expect(forbidden.status).toBe(403);
    expect(revoked.status).toBe(200);
    expect(repeated.status).toBe(409);
    expect(stored.rows[0].is_active).toBe(false);
    expect(audits.rows[0].count).toBe(1);
  });

  test('requires an active hackathon and rejects invites for a full team', async () => {
    const leader = await createUser();
    const upcoming = await createTeam(leader, await createHackathon({ status: 'upcoming' }));
    const inactive = await makeInvite(leader, upcoming.body.data.team.id);
    expect(inactive.status).toBe(409);

    const fullLeader = await createUser();
    const full = await createTeam(fullLeader, await createHackathon({ maxTeamSize: 1 }));
    expect((await makeInvite(fullLeader, full.body.data.team.id)).status).toBe(409);
  });

  test('limits repeated invite guesses for an authenticated user', async () => {
    const user = await createUser();
    const attempts = [];
    for (let index = 0; index < 11; index += 1) {
      attempts.push(await redeem(user, `guess-${index}-${randomUUID()}`));
    }
    expect(attempts.slice(0, 10).map((result) => result.status)).toEqual(Array(10).fill(404));
    expect(attempts[10].status).toBe(429);
    expect(attempts[10].body.message).toBe('Too many invite attempts. Try again later.');
    expect(attempts[10].headers['retry-after']).toEqual(expect.any(String));
  });

  test('serializes concurrent invite redemptions for one remaining seat', async () => {
    const leader = await createUser();
    const applicants = [];
    for (let index = 0; index < 10; index += 1) applicants.push(await createUser());
    const team = await createTeam(leader, await createHackathon({ maxTeamSize: 2 }));
    const teamId = team.body.data.team.id;
    const invite = await makeInvite(leader, teamId);

    const results = await Promise.allSettled(applicants.map((applicant) => redeem(applicant, invite.body.data.invite.code)));
    const statuses = results.map((result) => result.status === 'fulfilled' ? result.value.status : 'timeout');
    expect(statuses.filter((status) => status === 200)).toHaveLength(1);
    expect(statuses.filter((status) => status === 409)).toHaveLength(9);
    const state = await pool.query(
      `SELECT
         (SELECT COUNT(*)::INTEGER FROM team_members WHERE team_id = $1) AS members,
         (SELECT COUNT(*)::INTEGER FROM team_members WHERE hackathon_id = $2 GROUP BY hackathon_id) AS hackathon_members,
         (SELECT COUNT(*)::INTEGER FROM audit_logs WHERE team_id = $1 AND action = 'invite.redeemed') AS redemptions,
         (SELECT COUNT(*)::INTEGER FROM (SELECT user_id FROM team_members WHERE hackathon_id = $2 GROUP BY user_id HAVING COUNT(*) > 1) d) AS duplicates`,
      [teamId, team.body.data.team.hackathonId],
    );
    expect(state.rows[0]).toEqual({ members: 2, hackathon_members: 2, redemptions: 1, duplicates: 0 });
  }, 120000);

  test('ranks complementary skills and compatible time zones with explanations', async () => {
    const leader = await createUser('Suggestion Leader');
    const currentMember = await createUser('Current Team Member');
    const complementary = await createUser('Complementary Candidate');
    const overlapping = await createUser('Overlapping Candidate');
    const farTimeZone = await createUser('Far Time Zone Candidate');
    const assigned = await createUser('Already Assigned Candidate');
    const otherLeader = await createUser('Other Team Leader');
    const hackathonId = await createHackathon({ maxTeamSize: 8 });
    const team = await createTeam(leader, hackathonId);
    const teamId = team.body.data.team.id;
    const otherTeam = await createTeam(otherLeader, hackathonId);

    await pool.query(
      `INSERT INTO team_members (team_id, hackathon_id, user_id, role)
       VALUES ($1, $2, $3, 'member')`,
      [teamId, hackathonId, currentMember.id],
    );

    await setProfile(leader.id, ['Node.js'], 'UTC');
    await setProfile(currentMember.id, ['Node.js'], 'UTC');
    await setProfile(complementary.id, ['React', 'Design'], 'UTC');
    await setProfile(overlapping.id, ['Node.js'], 'UTC');
    await setProfile(farTimeZone.id, ['React', 'Design'], 'Pacific/Honolulu');
    await setProfile(assigned.id, ['React'], 'UTC');
    await setProfile(otherLeader.id, ['Go'], 'UTC');
    await pool.query(
      'INSERT INTO team_members (team_id, hackathon_id, user_id, role) VALUES ($1, $2, $3, \'member\')',
      [otherTeam.body.data.team.id, hackathonId, assigned.id],
    );

    const suggestions = await as(leader, request(app).get(`/api/teams/${teamId}/suggestions?limit=50`));
    expect(suggestions.status).toBe(200);
    expect(suggestions.body.data.teamSkillGaps).toEqual(['design', 'react']);
    const ranked = suggestions.body.data.suggestions;
    expect(ranked[0].userId).toBe(complementary.id);
    expect(ranked.findIndex((entry) => entry.userId === complementary.id))
      .toBeLessThan(ranked.findIndex((entry) => entry.userId === overlapping.id));
    expect(ranked[0]).toMatchObject({
      score: 100,
      scoreBreakdown: { skillCoverage: 60, timeZoneCompatibility: 40 },
      explanation: {
        matchedSkillGaps: ['design', 'react'],
        skillGapCoverage: '2/2',
        nearestTeamTimeZoneDifferenceHours: 0,
      },
    });
    expect(ranked.find((entry) => entry.userId === farTimeZone.id).scoreBreakdown.timeZoneCompatibility)
      .toBeLessThan(ranked[0].scoreBreakdown.timeZoneCompatibility);
    expect(ranked.some((entry) => [leader.id, currentMember.id, assigned.id, otherLeader.id].includes(entry.userId))).toBe(false);
    expect(suggestions.body.data.scoring.formula).toContain('60');
  }, 30000);

  test('requires team membership, active hackathon context, and a valid suggestion limit', async () => {
    const leader = await createUser();
    const outsider = await createUser();
    const team = await createTeam(leader, await createHackathon());
    const teamId = team.body.data.team.id;
    const denied = await as(outsider, request(app).get(`/api/teams/${teamId}/suggestions`));
    const invalidLimit = await as(leader, request(app).get(`/api/teams/${teamId}/suggestions?limit=51`));
    const missing = await as(leader, request(app).get(`/api/teams/${randomUUID()}/suggestions`));

    expect(denied.status).toBe(403);
    expect(invalidLimit.status).toBe(400);
    expect(missing.status).toBe(404);

    const upcomingLeader = await createUser();
    const upcomingTeam = await createTeam(upcomingLeader, await createHackathon({ status: 'upcoming' }));
    const inactive = await as(upcomingLeader, request(app).get(`/api/teams/${upcomingTeam.body.data.team.id}/suggestions`));
    expect(inactive.status).toBe(409);
  });

  test('excludes the requesting member and handles the no-candidate scoring edge case', async () => {
    const leader = await createUser();
    const team = await createTeam(leader, await createHackathon());
    const result = await as(leader, request(app).get(`/api/teams/${team.body.data.team.id}/suggestions`));
    expect(result.status).toBe(200);
    expect(result.body.data.suggestions.some((entry) => entry.userId === leader.id)).toBe(false);
    expect(rankCandidates({ candidates: [], teamSkills: ['TypeScript'], teamTimeZones: ['UTC'], limit: 10 }))
      .toEqual({ skillGaps: [], suggestions: [] });
  }, 30000);
});
