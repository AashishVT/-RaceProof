const { pool } = require('../config/database');

async function findHackathon(client, hackathonId, lock = false) {
  const result = await client.query(
    `
      SELECT id, status, min_team_size AS "minTeamSize", max_team_size AS "maxTeamSize"
      FROM hackathons
      WHERE id = $1
      ${lock ? 'FOR SHARE' : ''}
    `,
    [hackathonId],
  );
  return result.rows[0] || null;
}

async function createTeam(client, { hackathonId, teamName, leaderId }) {
  const result = await client.query(
    `
      INSERT INTO teams (hackathon_id, team_name, leader_id)
      VALUES ($1, $2, $3)
      RETURNING id, hackathon_id AS "hackathonId", team_name AS "teamName",
        leader_id AS "leaderId", created_at AS "createdAt"
    `,
    [hackathonId, teamName, leaderId],
  );
  return result.rows[0];
}

async function addMember(client, { teamId, hackathonId, userId, role = 'member' }) {
  const result = await client.query(
    `
      INSERT INTO team_members (team_id, hackathon_id, user_id, role)
      VALUES ($1, $2, $3, $4)
      RETURNING team_id AS "teamId", hackathon_id AS "hackathonId",
        user_id AS "userId", role, joined_at AS "joinedAt"
    `,
    [teamId, hackathonId, userId, role],
  );
  return result.rows[0];
}

async function insertAudit(client, { actorId, teamId, action, metadata }) {
  await client.query(
    `
      INSERT INTO audit_logs (actor_id, team_id, action, metadata)
      VALUES ($1, $2, $3, $4::JSONB)
    `,
    [actorId, teamId, action, JSON.stringify(metadata || {})],
  );
}

async function findTeamForUpdate(client, teamId) {
  const result = await client.query(
    `
      SELECT t.id, t.hackathon_id AS "hackathonId", t.team_name AS "teamName",
        t.leader_id AS "leaderId", h.status AS "hackathonStatus",
        h.min_team_size AS "minTeamSize", h.max_team_size AS "maxTeamSize",
        t.created_at AS "createdAt"
      FROM teams t
      JOIN hackathons h ON h.id = t.hackathon_id
      WHERE t.id = $1
      FOR UPDATE OF t
    `,
    [teamId],
  );
  return result.rows[0] || null;
}

async function lockHackathon(client, hackathonId) {
  const result = await client.query(
    'SELECT id, status FROM hackathons WHERE id = $1 FOR SHARE',
    [hackathonId],
  );
  return result.rows[0] || null;
}

async function countMembers(client, teamId) {
  const result = await client.query(
    'SELECT COUNT(*)::INTEGER AS count FROM team_members WHERE team_id = $1',
    [teamId],
  );
  return result.rows[0].count;
}

async function findMembershipInHackathon(client, hackathonId, userId) {
  const result = await client.query(
    `
      SELECT team_id AS "teamId", user_id AS "userId", role
      FROM team_members
      WHERE hackathon_id = $1 AND user_id = $2
      LIMIT 1
    `,
    [hackathonId, userId],
  );
  return result.rows[0] || null;
}

async function insertJoinRequest(client, { teamId, userId }) {
  const result = await client.query(
    `
      INSERT INTO join_requests (team_id, user_id)
      VALUES ($1, $2)
      RETURNING id, team_id AS "teamId", user_id AS "userId", status,
        created_at AS "createdAt", decided_at AS "decidedAt"
    `,
    [teamId, userId],
  );
  return result.rows[0];
}

async function listJoinRequests(client, teamId) {
  const result = await client.query(
    `
      SELECT jr.id, jr.team_id AS "teamId", jr.user_id AS "userId", jr.status,
        jr.created_at AS "createdAt", jr.decided_at AS "decidedAt",
        u.name AS "userName", u.email AS "userEmail", u.skills
      FROM join_requests jr
      JOIN users u ON u.id = jr.user_id
      WHERE jr.team_id = $1 AND jr.status = 'pending'
      ORDER BY jr.created_at, jr.id
    `,
    [teamId],
  );
  return result.rows;
}

async function listMyTeams(userId) {
  const result = await pool.query(
    `SELECT t.id, t.hackathon_id AS "hackathonId", t.team_name AS "teamName",
       t.leader_id AS "leaderId", h.name AS "hackathonName", h.status AS "hackathonStatus",
       h.min_team_size AS "minTeamSize", h.max_team_size AS "maxTeamSize",
       mine.role AS "userRole", mine.joined_at AS "joinedAt",
       COUNT(member.user_id)::INTEGER AS "memberCount",
       COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT(
         'userId', member.user_id, 'name', member_user.name,
         'timeZone', member_user.time_zone, 'role', member.role,
         'joinedAt', member.joined_at
       ) ORDER BY CASE WHEN member.role = 'leader' THEN 0 ELSE 1 END, member.joined_at, member.user_id), '[]'::JSONB) AS members
     FROM team_members mine
     JOIN teams t ON t.id = mine.team_id
     JOIN hackathons h ON h.id = t.hackathon_id
     JOIN team_members member ON member.team_id = t.id
     JOIN users member_user ON member_user.id = member.user_id
     WHERE mine.user_id = $1
     GROUP BY t.id, h.id, mine.role, mine.joined_at
     ORDER BY mine.joined_at DESC, t.id`,
    [userId],
  );
  return result.rows;
}

async function listMyPendingRequests(userId, { page, pageSize }) {
  const count = await pool.query(
    `SELECT COUNT(*)::INTEGER AS total FROM join_requests
     WHERE user_id = $1 AND status = 'pending'`,
    [userId],
  );
  const result = await pool.query(
    `SELECT jr.id, jr.team_id AS "teamId", jr.user_id AS "userId", jr.status,
       jr.created_at AS "createdAt", jr.decided_at AS "decidedAt",
       t.team_name AS "teamName", t.leader_id AS "leaderId",
       h.id AS "hackathonId", h.name AS "hackathonName", h.status AS "hackathonStatus"
     FROM join_requests jr
     JOIN teams t ON t.id = jr.team_id
     JOIN hackathons h ON h.id = t.hackathon_id
     WHERE jr.user_id = $1 AND jr.status = 'pending'
     ORDER BY jr.created_at DESC, jr.id
     LIMIT $2 OFFSET $3`,
    [userId, pageSize, (page - 1) * pageSize],
  );
  return { joinRequests: result.rows, total: count.rows[0].total };
}

async function listInvites(client, teamId) {
  const result = await client.query(
    `SELECT id, team_id AS "teamId", expires_at AS "expiresAt",
       is_active AS "isActive", created_at AS "createdAt",
       expires_at <= NOW() AS "isExpired"
     FROM invite_codes
     WHERE team_id = $1
     ORDER BY created_at DESC, id`,
    [teamId],
  );
  return result.rows;
}

async function findJoinRequestForUpdate(client, teamId, requestId) {
  const result = await client.query(
    `
      SELECT id, team_id AS "teamId", user_id AS "userId", status
      FROM join_requests
      WHERE team_id = $1 AND id = $2
      FOR UPDATE
    `,
    [teamId, requestId],
  );
  return result.rows[0] || null;
}

async function updateJoinRequestStatus(client, requestId, status) {
  const result = await client.query(
    `
      UPDATE join_requests
      SET status = $2, decided_at = NOW()
      WHERE id = $1
      RETURNING id, team_id AS "teamId", user_id AS "userId", status,
        created_at AS "createdAt", decided_at AS "decidedAt"
    `,
    [requestId, status],
  );
  return result.rows[0];
}

async function findTeam(client, teamId) {
  const result = await client.query(
    `
      SELECT t.id, t.hackathon_id AS "hackathonId", t.team_name AS "teamName",
        t.leader_id AS "leaderId", h.status AS "hackathonStatus",
        h.min_team_size AS "minTeamSize", h.max_team_size AS "maxTeamSize",
        t.created_at AS "createdAt"
      FROM teams t
      JOIN hackathons h ON h.id = t.hackathon_id
      WHERE t.id = $1
    `,
    [teamId],
  );
  return result.rows[0] || null;
}

async function listMembers(client, teamId) {
  const result = await client.query(
    `
      SELECT tm.user_id AS "userId", u.name, u.time_zone AS "timeZone", tm.role,
        tm.joined_at AS "joinedAt"
      FROM team_members tm
      JOIN users u ON u.id = tm.user_id
      WHERE tm.team_id = $1
      ORDER BY CASE WHEN tm.role = 'leader' THEN 0 ELSE 1 END, tm.joined_at, tm.user_id
    `,
    [teamId],
  );
  return result.rows;
}

async function listTeamSkills(client, teamId) {
  const result = await client.query(
    `SELECT u.skills
     FROM team_members tm
     JOIN users u ON u.id = tm.user_id
     WHERE tm.team_id = $1`,
    [teamId],
  );
  return result.rows.flatMap((row) => row.skills || []);
}

async function listEligibleSuggestionCandidates(client, hackathonId, teamId, requestingUserId) {
  const result = await client.query(
    `
      SELECT u.id AS "userId", u.name, u.skills, u.time_zone AS "timeZone"
      FROM users u
      WHERE u.id <> $3
        AND NOT EXISTS (
          SELECT 1 FROM team_members tm
          WHERE tm.hackathon_id = $1 AND tm.user_id = u.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM team_members tm
          WHERE tm.team_id = $2 AND tm.user_id = u.id
        )
      ORDER BY u.name, u.id
    `,
    [hackathonId, teamId, requestingUserId],
  );
  return result.rows;
}

async function findInviteTeamByHash(client, codeHash) {
  const result = await client.query(
    'SELECT team_id AS "teamId" FROM invite_codes WHERE code_hash = $1',
    [codeHash],
  );
  return result.rows[0] || null;
}

async function findInviteByHashForUpdate(client, teamId, codeHash) {
  const result = await client.query(
    `
      SELECT id, team_id AS "teamId", expires_at AS "expiresAt", is_active AS "isActive",
        expires_at > NOW() AS "isUnexpired"
      FROM invite_codes
      WHERE team_id = $1 AND code_hash = $2
      FOR UPDATE
    `,
    [teamId, codeHash],
  );
  return result.rows[0] || null;
}

async function insertInvite(client, { teamId, codeHash, expiresAt }) {
  const result = await client.query(
    `
      INSERT INTO invite_codes (team_id, code_hash, expires_at)
      VALUES ($1, $2, $3)
      RETURNING id, team_id AS "teamId", expires_at AS "expiresAt",
        is_active AS "isActive", created_at AS "createdAt"
    `,
    [teamId, codeHash, expiresAt],
  );
  return result.rows[0];
}

async function findInviteForUpdate(client, teamId, inviteId) {
  const result = await client.query(
    `
      SELECT id, team_id AS "teamId", expires_at AS "expiresAt", is_active AS "isActive"
      FROM invite_codes
      WHERE team_id = $1 AND id = $2
      FOR UPDATE
    `,
    [teamId, inviteId],
  );
  return result.rows[0] || null;
}

async function revokeInvite(client, inviteId) {
  const result = await client.query(
    `UPDATE invite_codes SET is_active = FALSE WHERE id = $1 AND is_active = TRUE
     RETURNING id, team_id AS "teamId", expires_at AS "expiresAt", is_active AS "isActive"`,
    [inviteId],
  );
  return result.rows[0] || null;
}

async function findMember(client, teamId, userId, lock = false) {
  const result = await client.query(
    `
      SELECT team_id AS "teamId", hackathon_id AS "hackathonId", user_id AS "userId",
        role, joined_at AS "joinedAt"
      FROM team_members
      WHERE team_id = $1 AND user_id = $2
      ${lock ? 'FOR UPDATE' : ''}
    `,
    [teamId, userId],
  );
  return result.rows[0] || null;
}

async function isTeamMember(teamId, userId) {
  const result = await pool.query(
    'SELECT 1 FROM team_members WHERE team_id = $1 AND user_id = $2 LIMIT 1',
    [teamId, userId],
  );
  return result.rowCount === 1;
}

async function findReplacementLeader(client, teamId, departingLeaderId) {
  const result = await client.query(
    `
      SELECT user_id AS "userId"
      FROM team_members
      WHERE team_id = $1 AND user_id <> $2
      ORDER BY joined_at, user_id
      LIMIT 1
      FOR UPDATE
    `,
    [teamId, departingLeaderId],
  );
  return result.rows[0] || null;
}

async function setMemberRole(client, teamId, userId, role) {
  await client.query(
    'UPDATE team_members SET role = $3 WHERE team_id = $1 AND user_id = $2',
    [teamId, userId, role],
  );
}

async function setTeamLeader(client, teamId, userId) {
  await client.query('UPDATE teams SET leader_id = $2 WHERE id = $1', [teamId, userId]);
}

async function removeMember(client, teamId, userId) {
  await client.query('DELETE FROM team_members WHERE team_id = $1 AND user_id = $2', [teamId, userId]);
}

async function deleteTeam(client, teamId) {
  await client.query('DELETE FROM teams WHERE id = $1', [teamId]);
}

async function insertIdempotencyRecord(client, { userId, key, requestHash }) {
  await client.query(
    `
      INSERT INTO idempotency_keys (user_id, idempotency_key, request_hash, expires_at)
      VALUES ($1, $2, $3, NOW() + INTERVAL '30 days')
      ON CONFLICT (user_id, idempotency_key) DO UPDATE
      SET request_hash = EXCLUDED.request_hash,
          response_data = NULL,
          expires_at = EXCLUDED.expires_at
      WHERE idempotency_keys.expires_at <= NOW()
    `,
    [userId, key, requestHash],
  );
}

async function findIdempotencyRecordForUpdate(client, userId, key) {
  const result = await client.query(
    `
      SELECT request_hash AS "requestHash", response_data AS "responseData"
      FROM idempotency_keys
      WHERE user_id = $1 AND idempotency_key = $2
      FOR UPDATE
    `,
    [userId, key],
  );
  return result.rows[0] || null;
}

async function saveIdempotencyResponse(client, { userId, key, responseData }) {
  await client.query(
    `
      UPDATE idempotency_keys
      SET response_data = $3::JSONB
      WHERE user_id = $1 AND idempotency_key = $2
    `,
    [userId, key, JSON.stringify(responseData)],
  );
}

async function getCurrentDatabase(client = pool) {
  const result = await client.query('SELECT current_database() AS name');
  return result.rows[0].name;
}

module.exports = {
  findHackathon,
  createTeam,
  addMember,
  insertAudit,
  findTeamForUpdate,
  lockHackathon,
  countMembers,
  findMembershipInHackathon,
  insertJoinRequest,
  listJoinRequests,
  listMyTeams,
  listMyPendingRequests,
  listInvites,
  findJoinRequestForUpdate,
  updateJoinRequestStatus,
  findTeam,
  listMembers,
  listTeamSkills,
  listEligibleSuggestionCandidates,
  findMember,
  isTeamMember,
  findReplacementLeader,
  setMemberRole,
  setTeamLeader,
  removeMember,
  deleteTeam,
  insertIdempotencyRecord,
  findIdempotencyRecordForUpdate,
  saveIdempotencyResponse,
  findInviteTeamByHash,
  findInviteByHashForUpdate,
  insertInvite,
  findInviteForUpdate,
  revokeInvite,
  getCurrentDatabase,
};
