const express = require('express');
const authController = require('../controllers/auth.controller');
const authenticate = require('../middleware/authenticate.middleware');
const validateBody = require('../middleware/validate-body.middleware');
const { registrationSchema, loginSchema } = require('../validators/auth.validator');

const router = express.Router();

router.post('/register', validateBody(registrationSchema), authController.register);
router.post('/login', validateBody(loginSchema), authController.login);
router.get('/me', authenticate, authController.getCurrentUser);

module.exports = router;
