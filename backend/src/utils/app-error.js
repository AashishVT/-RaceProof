class AppError extends Error {
  constructor(message, statusCode, options = {}) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.publicMessage = options.publicMessage || message;

    if (options.details) {
      this.details = options.details;
    }
  }
}

module.exports = AppError;
