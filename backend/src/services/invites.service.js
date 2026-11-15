const { createHash, randomBytes } = require('node:crypto');
const { pool } = require('../config/database');
const teamsRepository = require('../repositories/teams.repository');
const AppError = require('../utils/app-error');
const { publishTeamEvent } = require('../realtime/team-events');

const genericUnavailableError = () => new AppError('Invite code is invalid or unavailable.', 404);

async function inTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (_rollbackError) {
      // Preserve the original operation error.
    }
    if (error.code === '23505' && error.constraint === 'team_members_hackathon_user_unique') {
      throw new AppError('You already belong to a team in this hackathon.', 409);
    }
    throw error;
  } finally {
    client.release();
  }
}

function inviteResponse(statusCode, message, data) {
  return { statusCode, body: { success: true, message, data } };
}

function assertLeader(team, userId) {
  if (team.leaderId !== userId) throw new AppError('Only the team leader can manage invite codes.', 403);
}

async function createInvite({ actorId, teamId, expiresInHours }) {
  return inTransaction(async (client) => {
    const team = await teamsRepository.findTeamForUpdate(client, teamId);
    if (!team) throw new AppError('Team not found.', 404);
    assertLeader(team, actorId);

    const hackathon = await teamsRepository.lockHackathon(client, team.hackathonId);
    if (!hackathon || hackathon.status !== 'active') {
      throw new AppError('Invite codes can only be created for active hackathons.', 409);
    }
    if (await teamsRepository.countMembers(client, teamId) >= team.maxTeamSize) {
      throw new AppError('This team is full.', 409);
    }

    const code = randomBytes(32).toString('base64url');
    const codeHash = createHash('sha256').update(code).digest('hex');
    const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);
    const invite = await teamsRepository.insertInvite(client, { teamId, codeHash, expiresAt });
    await teamsRepository.insertAudit(client, {
      actorId,
      teamId,
      action: 'invite.created',
      metadata: { inviteId: invite.id, expiresAt: invite.expiresAt },
    });
    return inviteResponse(201, 'Invite code created.', { invite: { ...invite, code } });
  });
}

async function revokeInvite({ actorId, teamId, inviteId }) {
  const result = await inTransaction(async (client) => {
    const team = await teamsRepository.findTeamForUpdate(client, teamId);
    if (!team) throw new AppError('Team not found.', 404);
    assertLeader(team, actorId);

    const invite = await teamsRepository.findInviteForUpdate(client, teamId, inviteId);
    if (!invite) throw new AppError('Invite code not found.', 404);
    if (!invite.isActive) throw new AppError('Invite code is already revoked.', 409);

    const revokedInvite = await teamsRepository.revokeInvite(client, inviteId);
    await teamsRepository.insertAudit(client, {
      actorId,
      teamId,
      action: 'invite.revoked',
      metadata: { inviteId },
    });
    return inviteResponse(200, 'Invite code revoked.', { invite: revokedInvite });
  });
  publishTeamEvent(teamId, 'team:invite_revoked', { teamId, inviteId });
  return result;
}

async function listInvites({ actorId, teamId }) {
  return inTransaction(async (client) => {
    const team = await teamsRepository.findTeamForUpdate(client, teamId);
    if (!team) throw new AppError('Team not found.', 404);
    assertLeader(team, actorId);
    const invites = await teamsRepository.listInvites(client, teamId);
    return inviteResponse(200, 'Invite codes retrieved.', { invites });
  });
}

async function redeemInvite({ actorId, code }) {
  const codeHash = createHash('sha256').update(code).digest('hex');
  const result = await inTransaction(async (client) => {
    // First read only discovers the team. Lock order remains team then invite,
    // matching revocation and other team membership changes.
    const inviteHint = await teamsRepository.findInviteTeamByHash(client, codeHash);
    if (!inviteHint) throw genericUnavailableError();

    const team = await teamsRepository.findTeamForUpdate(client, inviteHint.teamId);
    if (!team) throw genericUnavailableError();
    const invite = await teamsRepository.findInviteByHashForUpdate(client, team.id, codeHash);
    if (!invite || !invite.isActive || !invite.isUnexpired) throw genericUnavailableError();

    const hackathon = await teamsRepository.lockHackathon(client, team.hackathonId);
    if (!hackathon || hackathon.status !== 'active') {
      throw new AppError('The hackathon must be active to redeem an invite.', 409);
    }
    if (await teamsRepository.findMembershipInHackathon(client, team.hackathonId, actorId)) {
      throw new AppError('You already belong to a team in this hackathon.', 409);
    }
    if (await teamsRepository.countMembers(client, team.id) >= team.maxTeamSize) {
      throw new AppError('This team is full.', 409);
    }

    const member = await teamsRepository.addMember(client, {
      teamId: team.id,
      hackathonId: team.hackathonId,
      userId: actorId,
    });
    await teamsRepository.insertAudit(client, {
      actorId,
      teamId: team.id,
      action: 'invite.redeemed',
      metadata: { inviteId: invite.id },
    });
    return inviteResponse(200, 'Invite redeemed.', { teamId: team.id, member });
  });
  publishTeamEvent(result.body.data.teamId, 'team:member_joined', {
    teamId: result.body.data.teamId,
    userId: actorId,
    source: 'invite',
  }, { userIds: [actorId] });
  return result;
}

module.exports = { createInvite, listInvites, revokeInvite, redeemInvite };
