const { checkDatabaseConnection } = require('../config/database');

async function getDatabaseHealth(_request, response, next) {
  try {
    await checkDatabaseConnection();
    response.status(200).json({
      success: true,
      message: 'Database connected successfully',
    });
  } catch (error) {
    error.statusCode = 503;
    error.publicMessage = 'Database unavailable';
    next(error);
  }
}

module.exports = { getDatabaseHealth };
