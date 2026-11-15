const express = require('express');
const { z } = require('zod');
const authenticate = require('../middleware/authenticate.middleware');
const controller = require('../controllers/hackathons.controller');
const AppError = require('../utils/app-error');

const router = express.Router();
router.param('hackathonId', (request, _response, next, value) => {
  if (!z.uuid().safeParse(value).success) return next(new AppError('Invalid hackathon ID.', 400));
  return next();
});
router.use(authenticate);
router.get('/', controller.list);
router.get('/:hackathonId', controller.get);
router.get('/:hackathonId/teams', controller.listTeams);

module.exports = router;
