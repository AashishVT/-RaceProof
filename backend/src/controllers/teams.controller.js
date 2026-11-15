const teamsService = require('../services/teams.service');
const AppError = require('../utils/app-error');

function sendMutation(response, result) {
  return response.status(result.statusCode).json(result.body);
}

async function createTeam(request, response, next) {
  try {
    return sendMutation(response, await teamsService.createTeam({
      actorId: request.user.id,
      input: request.body,
      idempotencyKey: request.get('Idempotency-Key'),
    }));
  } catch (error) {
    return next(error);
  }
}

async function getTeam(request, response, next) {
  try {
    const team = await teamsService.getTeam({ teamId: request.params.teamId });
    return response.status(200).json({ success: true, data: { team } });
  } catch (error) {
    return next(error);
  }
}

async function getMyTeams(request, response, next) {
  try {
    const result = await teamsService.getMyTeams({ actorId: request.user.id });
    return response.status(200).json({ success: true, data: result });
  } catch (error) { return next(error); }
}

async function getMyRequests(request, response, next) {
  try {
    const page = request.query.page === undefined ? 1 : Number(request.query.page);
    const pageSize = request.query.pageSize === undefined ? 20 : Number(request.query.pageSize);
    if (!Number.isInteger(page) || page < 1 || page > 100000
      || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      throw new AppError('page and pageSize are out of range.', 400);
    }
    const result = await teamsService.getMyPendingRequests({ actorId: request.user.id, page, pageSize });
    return response.status(200).json({ success: true, data: result });
  } catch (error) { return next(error); }
}

async function requestToJoin(request, response, next) {
  try {
    return sendMutation(response, await teamsService.requestToJoin({
      actorId: request.user.id,
      teamId: request.params.teamId,
      idempotencyKey: request.get('Idempotency-Key'),
    }));
  } catch (error) {
    return next(error);
  }
}

async function listJoinRequests(request, response, next) {
  try {
    const joinRequests = await teamsService.listJoinRequests({
      actorId: request.user.id,
      teamId: request.params.teamId,
    });
    return response.status(200).json({ success: true, data: { joinRequests } });
  } catch (error) {
    return next(error);
  }
}

async function acceptJoinRequest(request, response, next) {
  try {
    return sendMutation(response, await teamsService.acceptJoinRequest({
      actorId: request.user.id,
      teamId: request.params.teamId,
      requestId: request.params.requestId,
      idempotencyKey: request.get('Idempotency-Key'),
    }));
  } catch (error) {
    return next(error);
  }
}

async function declineJoinRequest(request, response, next) {
  try {
    return sendMutation(response, await teamsService.declineJoinRequest({
      actorId: request.user.id,
      teamId: request.params.teamId,
      requestId: request.params.requestId,
      idempotencyKey: request.get('Idempotency-Key'),
    }));
  } catch (error) {
    return next(error);
  }
}

async function removeMember(request, response, next) {
  try {
    return sendMutation(response, await teamsService.removeMember({
      actorId: request.user.id,
      teamId: request.params.teamId,
      memberId: request.params.memberId,
      idempotencyKey: request.get('Idempotency-Key'),
    }));
  } catch (error) {
    return next(error);
  }
}

async function leaveTeam(request, response, next) {
  try {
    return sendMutation(response, await teamsService.leaveTeam({
      actorId: request.user.id,
      teamId: request.params.teamId,
      idempotencyKey: request.get('Idempotency-Key'),
    }));
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  createTeam,
  getTeam,
  getMyTeams,
  getMyRequests,
  requestToJoin,
  listJoinRequests,
  acceptJoinRequest,
  declineJoinRequest,
  removeMember,
  leaveTeam,
};
