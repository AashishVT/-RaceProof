const AppError = require('../utils/app-error');

function validateBody(schema) {
  return (request, _response, next) => {
    const result = schema.safeParse(request.body);

    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));

      return next(new AppError('Request validation failed.', 400, { details }));
    }

    request.body = result.data;
    return next();
  };
}

module.exports = validateBody;
