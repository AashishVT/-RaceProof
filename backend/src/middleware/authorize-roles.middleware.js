const AppError = require('../utils/app-error');

function authorizeRoles(...allowedRoles) {
  return (request, _response, next) => {
    if (!request.user) {
      return next(new AppError('Authentication required.', 401));
    }

    const userRoles = Array.isArray(request.user.roles)
      ? request.user.roles
      : request.user.role
        ? [request.user.role]
        : [];

    if (!allowedRoles.some((role) => userRoles.includes(role))) {
      return next(new AppError('You do not have permission to perform this action.', 403));
    }

    return next();
  };
}

module.exports = authorizeRoles;
