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

  // Errors the body parser raises before any of our code runs. They are the
  // client's fault, not a bug, and must not be logged as internal failures or
  // returned as 500 — a malformed request is a 400, an oversized one a 413.
  // Left as 500 they inflate the error log and, worse, the parser's own message
  // ("Expected property name…") leaks the framework in non-production.
  if (err.type === 'entity.too.large') {
    return failure(res, {
      message: 'حجم درخواست بیش از حد مجاز است.',
      code: ERROR_CODES.VALIDATION,
      statusCode: 413,
      requestId: req.id,
    });
  }
  if (err.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    return failure(res, {
      message: 'ساختار درخواست معتبر نیست.',
      code: ERROR_CODES.VALIDATION,
      statusCode: 400,
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
