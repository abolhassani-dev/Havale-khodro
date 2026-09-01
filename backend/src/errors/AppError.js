const { ERROR_CODES } = require('../constants/errorCodes');

/**
 * Errors the application throws on purpose.
 *
 * `isOperational` separates expected failures (bad input, missing record) from
 * genuine bugs. The error handler can safely show the first kind to the client
 * and must not show the second, because unexpected errors leak internals.
 */
class AppError extends Error {
  constructor(message, statusCode = 500, code = ERROR_CODES.INTERNAL, details = null) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

class BadRequestError extends AppError {
  constructor(message = 'Bad request', details = null) {
    super(message, 400, ERROR_CODES.BAD_REQUEST, details);
  }
}

class ValidationError extends AppError {
  constructor(message = 'Validation failed', details = null) {
    super(message, 422, ERROR_CODES.VALIDATION, details);
  }
}

/**
 * The 401 and 403 families take an optional code because the client has to tell
 * their causes apart: a kicked session, an expired subscription and a reached
 * reveal cap all need different screens. Matching on the Persian message instead
 * would break the interface the first time someone rewords a sentence.
 */
class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required', code = ERROR_CODES.UNAUTHORIZED) {
    super(message, 401, code);
  }
}

class ForbiddenError extends AppError {
  constructor(message = 'Not allowed', code = ERROR_CODES.FORBIDDEN) {
    super(message, 403, code);
  }
}

/**
 * Takes the noun, not the sentence — «حواله», «آگهی خودرو», «تیکت» — and says
 * it in Persian. The sentence used to be built in English around a Persian
 * noun, which put «آگهی خودرو not found» in front of an agency in a toast.
 * Callers pass the thing; the wording lives here so it stays one wording.
 */
class NotFoundError extends AppError {
  constructor(resource = 'مورد درخواستی') {
    super(`${resource} پیدا نشد`, 404, ERROR_CODES.NOT_FOUND);
  }
}

class ConflictError extends AppError {
  constructor(message = 'Resource already exists') {
    super(message, 409, ERROR_CODES.CONFLICT);
  }
}

module.exports = {
  AppError,
  BadRequestError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
};
