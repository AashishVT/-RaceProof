const express = require('express');
const { getDatabaseHealth } = require('../controllers/database-health.controller');

const router = express.Router();

router.get('/health/db', getDatabaseHealth);

module.exports = router;
