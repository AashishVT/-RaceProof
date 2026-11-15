const express = require('express');
const healthRoutes = require('./health.routes');
const databaseHealthRoutes = require('./database-health.routes');
const authRoutes = require('./auth.routes');
const teamsRoutes = require('./teams.routes');
const hackathonsRoutes = require('./hackathons.routes');

const router = express.Router();

router.use('/api', healthRoutes);
router.use('/api', databaseHealthRoutes);
router.use('/api/auth', authRoutes);
router.use('/api/teams', teamsRoutes);
router.use('/api/hackathons', hackathonsRoutes);

module.exports = router;
