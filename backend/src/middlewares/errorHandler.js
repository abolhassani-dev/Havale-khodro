const config = require('../config');
const logger = require('../utils/logger');
const { AppError } = require('../errors/AppError');
const { ERROR_CODES } = require('../constants/errorCodes');
const { failure } = require('../responses/apiResponse');
const errorLogService = require('../modules/alert/errorLog.service');

/**
 * The only place errors become responses.
 *
 * Expected failures carry their own status and code. Anything else is a bug: it
 * gets logged in full and returned as a generic 500, because driver messages and
 * stack traces tell an attacker about your internals.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof AppError && err.isOperational) {
    logger.warn(err.message, { code: err.code, path: req.originalUrl, requestId: req.id });
    return failure(res, {
      message: err.message,
      code: err.code,
      statusCode: err.statusCode,
      details: err.details,
      requestId: req.id,
    });
  }

  logger.error('Unhandled error', {
    message: err.message,
    stack: err.stack,
    path: req.originalUrl,
    requestId: req.id,
  });

  // Recorded where a developer can read it without SSH, and alerted on. Not
  // awaited: the user is waiting for a response, and a slow database or an
  // unreachable Telegram must not add seconds to an error page.
  errorLogService.record(err, req).catch(() => {});

  return failure(res, {
    message: config.isProduction ? 'Something went wrong' : err.message,
    code: ERROR_CODES.INTERNAL,
    statusCode: 500,
    requestId: req.id,
  });
}

module.exports = errorHandler;
