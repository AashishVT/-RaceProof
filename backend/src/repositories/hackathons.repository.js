const { pool } = require('../config/database');

function escapeLike(value) {
  return value.replace(/[\\%_]/g, '\\$&');
}

async function listHackathons({ page, pageSize, search, statuses }) {
  const values = [];
  const filters = [];
  if (search) {
    values.push(`%${escapeLike(search)}%`);
    filters.push(`name ILIKE $${values.length} ESCAPE '\\'`);
  }
  if (statuses?.length) {
    values.push(statuses);
    filters.push(`status = ANY($${values.length}::TEXT[])`);
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const count = await pool.query(`SELECT COUNT(*)::INTEGER AS total FROM hackathons ${where}`, values);
  const total = count.rows[0].total;
  const offset = (page - 1) * pageSize;
  const result = await pool.query(
    `SELECT id, name, status, min_team_size AS "minTeamSize",
       max_team_size AS "maxTeamSize", created_at AS "createdAt"
     FROM hackathons ${where}
     ORDER BY created_at DESC, id
     LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, pageSize, offset],
  );
  return { hackathons: result.rows, total };
}

async function findHackathon(hackathonId) {
  const result = await pool.query(
    `SELECT id, name, status, min_team_size AS "minTeamSize",
       max_team_size AS "maxTeamSize", created_at AS "createdAt"
     FROM hackathons WHERE id = $1`,
    [hackathonId],
  );
  return result.rows[0] || null;
}

async function listTeams({ hackathonId, page, pageSize, search, availableOnly }) {
  const result = await pool.query(
    `WITH selected_hackathon AS (
       SELECT id, name, status, min_team_size, max_team_size
       FROM hackathons
       WHERE id = $1
     ), team_counts AS (
       SELECT t.id, t.hackathon_id, t.team_name, t.leader_id, t.created_at,
         h.name AS hackathon_name, h.status AS hackathon_status,
         h.min_team_size, h.max_team_size, COUNT(tm.user_id)::INTEGER AS member_count
       FROM selected_hackathon h
       JOIN teams t ON t.hackathon_id = h.id
       LEFT JOIN team_members tm ON tm.team_id = t.id
       GROUP BY t.id, h.id, h.name, h.status, h.min_team_size, h.max_team_size
     ), filtered_teams AS (
       SELECT * FROM team_counts
       WHERE ($2::TEXT IS NULL OR team_name ILIKE $2 ESCAPE '\\')
         AND (NOT $3::BOOLEAN OR member_count < max_team_size)
     ), page AS (
       SELECT * FROM filtered_teams
       ORDER BY created_at DESC, id
       LIMIT $4 OFFSET $5
     )
     SELECT h.id AS "__hackathonId",
       (SELECT COUNT(*)::INTEGER FROM filtered_teams) AS "__total",
       p.id, p.hackathon_id AS "hackathonId", p.team_name AS "teamName",
       p.leader_id AS "leaderId", p.created_at AS "createdAt",
       p.hackathon_name AS "hackathonName", p.hackathon_status AS "hackathonStatus",
       p.min_team_size AS "minTeamSize", p.max_team_size AS "maxTeamSize",
       p.member_count AS "memberCount",
       GREATEST(p.max_team_size - p.member_count, 0) AS "seatsAvailable"
     FROM selected_hackathon h
     LEFT JOIN page p ON TRUE
     ORDER BY p.created_at DESC NULLS LAST, p.id`,
    [
      hackathonId,
      search ? `%${escapeLike(search)}%` : null,
      availableOnly,
      pageSize,
      (page - 1) * pageSize,
    ],
  );
  if (!result.rows.length) return null;

  const first = result.rows[0];
  return {
    teams: result.rows.filter((row) => row.id !== null).map(({ __hackathonId, __total, ...team }) => team),
    total: first.__total,
  };
}

module.exports = { listHackathons, findHackathon, listTeams };
