const { NotFoundError } = require('../errors/AppError');

/**
 * A request for an address this API does not have.
 *
 * The address is no longer repeated back in the message. It told the reader
 * nothing they had not just typed, and an error that quotes its own input is
 * one more place to have to think about what that input could contain. The
 * path is in the server's log, under the requestId the response carries.
 *
 * Whether the refusal comes back as JSON or as the site's error page is not
 * decided here — errorHandler decides that for every refusal alike, from what
 * the caller asked for.
 */
function notFound(req, _res, next) {
  next(new NotFoundError('مسیر درخواستی'));
}

module.exports = notFound;
