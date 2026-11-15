const express = require('express');
const { z } = require('zod');
const teamsController = require('../controllers/teams.controller');
const invitesController = require('../controllers/invites.controller');
const suggestionsController = require('../controllers/suggestions.controller');
const authenticate = require('../middleware/authenticate.middleware');
const validateBody = require('../middleware/validate-body.middleware');
const inviteRateLimit = require('../middleware/invite-rate-limit.middleware');
const {
  createTeamSchema,
  emptyBodySchema,
  createInviteSchema,
  redeemInviteSchema,
} = require('../validators/teams.validator');
const AppError = require('../utils/app-error');

const router = express.Router();
const uuidSchema = z.uuid();

function validateUuidParameter(name) {
  return (request, _response, next, value) => {
    if (!uuidSchema.safeParse(value).success) {
      return next(new AppError(`Invalid ${name}.`, 400));
    }
    return next();
  };
}

router.param('teamId', validateUuidParameter('team ID'));
router.param('requestId', validateUuidParameter('join request ID'));
router.param('memberId', validateUuidParameter('member ID'));
router.param('inviteId', validateUuidParameter('invite ID'));

router.use(authenticate);
router.post('/', validateBody(createTeamSchema), teamsController.createTeam);
router.post('/invites/redeem', inviteRateLimit, validateBody(redeemInviteSchema), invitesController.redeemInvite);
router.get('/my', teamsController.getMyTeams);
router.get('/my/requests', teamsController.getMyRequests);
router.get('/:teamId', teamsController.getTeam);
router.get('/:teamId/suggestions', suggestionsController.getSuggestions);
router.post('/:teamId/join-requests', validateBody(emptyBodySchema), teamsController.requestToJoin);
router.get('/:teamId/join-requests', teamsController.listJoinRequests);
router.post('/:teamId/join-requests/:requestId/accept', validateBody(emptyBodySchema), teamsController.acceptJoinRequest);
router.post('/:teamId/join-requests/:requestId/decline', validateBody(emptyBodySchema), teamsController.declineJoinRequest);
router.delete('/:teamId/members/:memberId', teamsController.removeMember);
router.delete('/:teamId/leave', teamsController.leaveTeam);
router.post('/:teamId/invites', validateBody(createInviteSchema), invitesController.createInvite);
router.get('/:teamId/invites', invitesController.listInvites);
router.delete('/:teamId/invites/:inviteId', invitesController.revokeInvite);

module.exports = router;
