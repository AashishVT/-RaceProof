const crypto = require('node:crypto');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ||= crypto.randomBytes(32).toString('hex');
