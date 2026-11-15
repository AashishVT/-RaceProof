function errorHandler(error, _request, response, _next) {
  const statusCode = Number.isInteger(error.statusCode)
    ? error.statusCode
    : Number.isInteger(error.status)
      ? error.status
      : 500;
  const message = error.publicMessage
    || (statusCode >= 500 ? 'Internal server error' : error.message);

  if (statusCode >= 500) {
    console.error(error);
  }

  response.status(statusCode).json({
    success: false,
    message,
    ...(error.details ? { details: error.details } : {}),
  });
}

module.exports = errorHandler;
