const { randomUUID } = require('crypto');

/**
 * Attaches an id to every request and echoes it back.
 *
 * When a user reports "it failed at 3pm", this is what turns that into the exact
 * log lines for that one request.
 */
function requestId(req, res, next) {
  req.id = req.headers['x-request-id'] || randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
}

module.exports = requestId;
