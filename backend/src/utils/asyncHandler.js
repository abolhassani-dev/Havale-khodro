/**
 * Wraps an async route handler so a rejected promise reaches the error
 * middleware. Without it, an async throw becomes an unhandled rejection and the
 * request hangs until it times out.
 */
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = asyncHandler;
