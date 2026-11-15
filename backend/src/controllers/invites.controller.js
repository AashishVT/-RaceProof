const invitesService = require('../services/invites.service');

function sendResult(response, result) {
  return response.status(result.statusCode).json(result.body);
}

async function createInvite(request, response, next) {
  try {
    return sendResult(response, await invitesService.createInvite({
      actorId: request.user.id,
      teamId: request.params.teamId,
      expiresInHours: request.body.expiresInHours,
    }));
  } catch (error) {
    return next(error);
  }
}

async function revokeInvite(request, response, next) {
  try {
    return sendResult(response, await invitesService.revokeInvite({
      actorId: request.user.id,
      teamId: request.params.teamId,
      inviteId: request.params.inviteId,
    }));
  } catch (error) {
    return next(error);
  }
}

async function listInvites(request, response, next) {
  try {
    return sendResult(response, await invitesService.listInvites({
      actorId: request.user.id,
      teamId: request.params.teamId,
    }));
  } catch (error) { return next(error); }
}

async function redeemInvite(request, response, next) {
  try {
    return sendResult(response, await invitesService.redeemInvite({
      actorId: request.user.id,
      code: request.body.code,
    }));
  } catch (error) {
    return next(error);
  }
}

module.exports = { createInvite, listInvites, revokeInvite, redeemInvite };
