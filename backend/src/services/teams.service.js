const { createHash } = require('node:crypto');
const { pool } = require('../config/database');
const teamsRepository = require('../repositories/teams.repository');
const AppError = require('../utils/app-error');
const { publishTeamEvent, publishTeamEvents } = require('../realtime/team-events');

function response(statusCode, message, data) {
  return { statusCode, body: { success: true, message, data } };
}

function requestFingerprint(operation, payload) {
  return createHash('sha256')
    .update(JSON.stringify({ operation, payload }))
    .digest('hex');
}

function normalizeIdempotencyKey(value) {
  if (value === undefined) return null;
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,255}$/.test(value)) {
    throw new AppError('Idempotency-Key must contain 1 to 255 letters, numbers, periods, underscores, colons, or hyphens.', 400);
  }
  return value;
}

function mapDatabaseError(error) {
  if (error.code === '23505') {
    if (error.constraint === 'teams_hackathon_name_unique') {
      return new AppError('A team with this name already exists for this hackathon.', 409);
    }
    if (error.constraint === 'join_requests_one_pending_per_user_team_idx') {
      return new AppError('A pending join request already exists.', 409);
    }
    if (
      error.constraint === 'team_members_hackathon_user_unique'
      || error.constraint === 'team_members_team_user_unique'
    ) {
      return new AppError('The user already belongs to a team in this hackathon.', 409);
    }
  }
  return error;
}

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
    throw mapDatabaseError(error);
  } finally {
    client.release();
  }
}

async function runMutation({ actorId, idempotencyKey, operation, payload, work, afterCommit }) {
  const key = normalizeIdempotencyKey(idempotencyKey);
  const requestHash = requestFingerprint(operation, payload);

  const outcome = await inTransaction(async (client) => {
    if (key) {
      await teamsRepository.insertIdempotencyRecord(client, {
        userId: actorId,
        key,
        requestHash,
      });
      const prior = await teamsRepository.findIdempotencyRecordForUpdate(client, actorId, key);

      if (!prior || prior.requestHash !== requestHash) {
        throw new AppError('Idempotency-Key was already used for a different request.', 409);
      }

      if (prior.responseData !== null) {
        return { result: prior.responseData, replayed: true };
      }
    }

    const result = await work(client);
    if (key) {
      await teamsRepository.saveIdempotencyResponse(client, {
        userId: actorId,
        key,
        responseData: result,
      });
    }
    return { result, replayed: false };
  });

  if (!outcome.replayed && afterCommit) {
    try {
      afterCommit(outcome.result);
    } catch (error) {
      console.error('Post-commit team event setup failed.', error && (error.code || error.name) || 'unknown');
    }
  }
  return outcome.result;
}

function assertLeader(team, actorId) {
  if (team.leaderId !== actorId) {
    throw new AppError('Only the team leader can perform this action.', 403);
  }
}

function assertActiveHackathon(hackathon) {
  if (!hackathon || hackathon.status !== 'active') {
    throw new AppError('The hackathon must be active for this action.', 409);
  }
}

function teamResponse(team, members) {
  return {
    ...team,
    memberCount: members.length,
    members,
  };
}

async function createTeam({ actorId, input, idempotencyKey }) {
  const operation = 'team.create';
  const payload = input;
  return runMutation({ actorId, idempotencyKey, operation, payload, afterCommit: (result) => {
    const team = result.body.data.team;
    publishTeamEvent(team.id, 'team:created', {
      teamId: team.id,
      hackathonId: team.hackathonId,
      teamName: team.teamName,
      leaderId: team.leaderId,
    }, { userIds: [actorId] });
  }, work: async (client) => {
    const hackathon = await teamsRepository.findHackathon(client, input.hackathonId, true);
    if (!hackathon) throw new AppError('Hackathon not found.', 404);
    if (!['active', 'upcoming'].includes(hackathon.status)) {
      throw new AppError('Teams cannot be created for a completed or cancelled hackathon.', 409);
    }
    if (hackathon.minTeamSize < 1 || hackathon.maxTeamSize < hackathon.minTeamSize) {
      throw new AppError('Hackathon team-size limits are invalid.', 409);
    }

    const team = await teamsRepository.createTeam(client, {
      hackathonId: input.hackathonId,
      teamName: input.teamName,
      leaderId: actorId,
    });
    const leader = await teamsRepository.addMember(client, {
      teamId: team.id,
      hackathonId: input.hackathonId,
      userId: actorId,
      role: 'leader',
    });
    await teamsRepository.insertAudit(client, {
      actorId,
      teamId: team.id,
      action: 'team.created',
      metadata: { hackathonId: input.hackathonId, teamName: input.teamName },
    });

    return response(201, 'Team created successfully.', {
      team: teamResponse({
        ...team,
        minTeamSize: hackathon.minTeamSize,
        maxTeamSize: hackathon.maxTeamSize,
        hackathonStatus: hackathon.status,
      }, [leader]),
    });
  }});
}

async function getTeam({ teamId }) {
  const team = await teamsRepository.findTeam(pool, teamId);
  if (!team) throw new AppError('Team not found.', 404);
  const members = await teamsRepository.listMembers(pool, teamId);
  return teamResponse(team, members);
}

async function getMyTeams({ actorId }) {
  return { teams: await teamsRepository.listMyTeams(actorId) };
}

async function getMyPendingRequests({ actorId, page, pageSize }) {
  const result = await teamsRepository.listMyPendingRequests(actorId, { page, pageSize });
  return {
    joinRequests: result.joinRequests,
    pagination: {
      page,
      pageSize,
      total: result.total,
      totalPages: Math.ceil(result.total / pageSize),
    },
  };
}

async function requestToJoin({ actorId, teamId, idempotencyKey }) {
  const operation = 'team.join_request.create';
  const payload = { teamId };
  return runMutation({ actorId, idempotencyKey, operation, payload, afterCommit: (result) => {
    publishTeamEvent(teamId, 'team:join_request_created', {
      teamId,
      requestId: result.body.data.joinRequest.id,
      requesterId: actorId,
    });
  }, work: async (client) => {
    const team = await teamsRepository.findTeamForUpdate(client, teamId);
    if (!team) throw new AppError('Team not found.', 404);
    const hackathon = await teamsRepository.lockHackathon(client, team.hackathonId);
    assertActiveHackathon(hackathon);

    const memberCount = await teamsRepository.countMembers(client, teamId);
    if (memberCount >= team.maxTeamSize) {
      throw new AppError('This team is full.', 409);
    }
    if (await teamsRepository.findMembershipInHackathon(client, team.hackathonId, actorId)) {
      throw new AppError('You already belong to a team in this hackathon.', 409);
    }

    const joinRequest = await teamsRepository.insertJoinRequest(client, { teamId, userId: actorId });
    await teamsRepository.insertAudit(client, {
      actorId,
      teamId,
      action: 'join_request.created',
      metadata: { requestId: joinRequest.id },
    });
    return response(201, 'Join request created.', { joinRequest });
  }});
}

async function listJoinRequests({ actorId, teamId }) {
  const team = await teamsRepository.findTeam(pool, teamId);
  if (!team) throw new AppError('Team not found.', 404);
  assertLeader(team, actorId);
  return teamsRepository.listJoinRequests(pool, teamId);
}

async function acceptJoinRequest({ actorId, teamId, requestId, idempotencyKey }) {
  const operation = 'team.join_request.accept';
  const payload = { teamId, requestId };
  return runMutation({ actorId, idempotencyKey, operation, payload, afterCommit: (result) => {
    publishTeamEvent(teamId, 'team:join_request_accepted', {
      teamId,
      requestId,
      userId: result.body.data.member.userId,
    }, { userIds: [result.body.data.member.userId] });
  }, work: async (client) => {
    const team = await teamsRepository.findTeamForUpdate(client, teamId);
    if (!team) throw new AppError('Team not found.', 404);
    assertLeader(team, actorId);
    const hackathon = await teamsRepository.lockHackathon(client, team.hackathonId);
    assertActiveHackathon(hackathon);

    const joinRequest = await teamsRepository.findJoinRequestForUpdate(client, teamId, requestId);
    if (!joinRequest) throw new AppError('Join request not found.', 404);
    if (joinRequest.status !== 'pending') throw new AppError('Join request is no longer pending.', 409);

    const memberCount = await teamsRepository.countMembers(client, teamId);
    if (memberCount >= team.maxTeamSize) throw new AppError('This team is full.', 409);
    if (await teamsRepository.findMembershipInHackathon(client, team.hackathonId, joinRequest.userId)) {
      throw new AppError('The requester already belongs to a team in this hackathon.', 409);
    }

    const member = await teamsRepository.addMember(client, {
      teamId,
      hackathonId: team.hackathonId,
      userId: joinRequest.userId,
    });
    const updatedRequest = await teamsRepository.updateJoinRequestStatus(client, requestId, 'accepted');
    await teamsRepository.insertAudit(client, {
      actorId,
      teamId,
      action: 'join_request.accepted',
      metadata: { requestId, userId: joinRequest.userId },
    });
    return response(200, 'Join request accepted.', { joinRequest: updatedRequest, member });
  }});
}

async function declineJoinRequest({ actorId, teamId, requestId, idempotencyKey }) {
  const operation = 'team.join_request.decline';
  const payload = { teamId, requestId };
  return runMutation({ actorId, idempotencyKey, operation, payload, afterCommit: (result) => {
    publishTeamEvent(teamId, 'team:join_request_declined', {
      teamId,
      requestId,
      userId: result.body.data.joinRequest.userId,
    }, { userIds: [result.body.data.joinRequest.userId] });
  }, work: async (client) => {
    const team = await teamsRepository.findTeamForUpdate(client, teamId);
    if (!team) throw new AppError('Team not found.', 404);
    assertLeader(team, actorId);
    const joinRequest = await teamsRepository.findJoinRequestForUpdate(client, teamId, requestId);
    if (!joinRequest) throw new AppError('Join request not found.', 404);
    if (joinRequest.status !== 'pending') throw new AppError('Join request is no longer pending.', 409);

    const updatedRequest = await teamsRepository.updateJoinRequestStatus(client, requestId, 'rejected');
    await teamsRepository.insertAudit(client, {
      actorId,
      teamId,
      action: 'join_request.rejected',
      metadata: { requestId, userId: joinRequest.userId },
    });
    return response(200, 'Join request declined.', { joinRequest: updatedRequest });
  }});
}

async function removeMember({ actorId, teamId, memberId, idempotencyKey }) {
  const operation = 'team.member.remove';
  const payload = { teamId, memberId };
  return runMutation({ actorId, idempotencyKey, operation, payload, afterCommit: () => {
    publishTeamEvent(teamId, 'team:member_removed', {
      teamId,
      userId: memberId,
    }, { excludeUserIds: [memberId], userIds: [memberId] });
  }, work: async (client) => {
    const team = await teamsRepository.findTeamForUpdate(client, teamId);
    if (!team) throw new AppError('Team not found.', 404);
    assertLeader(team, actorId);
    const member = await teamsRepository.findMember(client, teamId, memberId, true);
    if (!member) throw new AppError('Team member not found.', 404);
    if (member.role === 'leader') {
      throw new AppError('The team leader must transfer leadership before leaving.', 409);
    }

    await teamsRepository.removeMember(client, teamId, memberId);
    await teamsRepository.insertAudit(client, {
      actorId,
      teamId,
      action: 'member.removed',
      metadata: { memberId },
    });
    return response(200, 'Team member removed.', { teamId, userId: memberId, removed: true });
  }});
}

async function leaveTeam({ actorId, teamId, idempotencyKey }) {
  const operation = 'team.member.leave';
  const payload = { teamId };
  let replacementLeaderId = null;
  return runMutation({ actorId, idempotencyKey, operation, payload, afterCommit: (result) => {
    const events = [];
    if (replacementLeaderId) {
      events.push({
        eventName: 'team:leadership_transferred',
        payload: { teamId, fromUserId: actorId, toUserId: replacementLeaderId },
      });
    }
    events.push({
      eventName: 'team:member_left',
      payload: { teamId, userId: actorId, teamDeleted: result.body.data.deleted },
    });
    publishTeamEvents(teamId, events, {
      excludeUserIds: [actorId],
      userIds: [actorId],
      closeTeamRoom: result.body.data.deleted,
    });
  }, work: async (client) => {
    const team = await teamsRepository.findTeamForUpdate(client, teamId);
    if (!team) throw new AppError('Team not found.', 404);
    const member = await teamsRepository.findMember(client, teamId, actorId, true);
    if (!member) throw new AppError('You are not a member of this team.', 404);

    if (member.role === 'leader') {
      const replacement = await teamsRepository.findReplacementLeader(client, teamId, actorId);
      if (replacement) {
        replacementLeaderId = replacement.userId;
        // Point the team at the replacement first. The migration 003 foreign key
        // is deferred, so the role changes below and this parent update are
        // checked together when the transaction commits.
        await teamsRepository.setTeamLeader(client, teamId, replacement.userId);
        await teamsRepository.setMemberRole(client, teamId, actorId, 'member');
        await teamsRepository.setMemberRole(client, teamId, replacement.userId, 'leader');
        await teamsRepository.insertAudit(client, {
          actorId,
          teamId,
          action: 'leadership.transferred',
          metadata: { fromUserId: actorId, toUserId: replacement.userId, reason: 'leader_left' },
        });
      }
    }

    await teamsRepository.removeMember(client, teamId, actorId);
    await teamsRepository.insertAudit(client, {
      actorId,
      teamId: team.id,
      action: 'member.left',
      metadata: { userId: actorId },
    });

    if (member.role === 'leader' && !(await teamsRepository.countMembers(client, teamId))) {
      await teamsRepository.deleteTeam(client, teamId);
      await teamsRepository.insertAudit(client, {
        actorId,
        teamId: null,
        action: 'team.deleted',
        metadata: { teamId, reason: 'last_member_left' },
      });
      return response(200, 'You left the team; the empty team was deleted.', { teamId, deleted: true });
    }

    return response(200, 'You left the team.', { teamId, deleted: false });
  }});
}

module.exports = {
  createTeam,
  getTeam,
  getMyTeams,
  getMyPendingRequests,
  requestToJoin,
  listJoinRequests,
  acceptJoinRequest,
  declineJoinRequest,
  removeMember,
  leaveTeam,
};
