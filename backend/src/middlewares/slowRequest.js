const config = require('../config');
const errorLogService = require('../modules/alert/errorLog.service');

/**
 * Requests that took too long, and only those.
 *
 * ── Why not log every request ───────────────────────────────────────────────
 *
 * A row per request is the obvious design and the wrong one on this machine. At
 * a few requests a second it is millions of rows a month, each one an extra
 * write on the hot path, to answer a question — "what is slow?" — that only the
 * outliers can answer anyway. The fast ones are noise measured in gigabytes.
 *
 * So nothing is written until a request crosses the threshold, and repeats
 * collapse onto one row by fingerprint the way errors already do: a hundred
 * thousand fast requests cost nothing at all, and ten slow ones on the same
 * route are one row with a count of ten and the worst time seen.
 *
 * ── What it costs when it does nothing ──────────────────────────────────────
 *
 * One `bigint` read and one listener per request. The listener fires on
 * `finish`, after the response is on the wire, so the measurement is never on
 * the path of the answer.
 */
function slowRequest(req, res, next) {
  const started = process.hrtime.bigint();

  /**
   * How long the server itself took, on the response.
   *
   * The question «is it the server or is it my connection?» cannot be answered
   * from the outside without this: a request that takes 900ms end to end is a
   * slow server or a slow route between here and Tehran, and the two need
   * completely different fixes. With this header, deploy/perf-check.sh subtracts
   * one from the other and says which.
   *
   * Set by wrapping writeHead rather than in the `finish` handler, because by
   * the time a response has finished its headers are long gone.
   */
  const writeHead = res.writeHead;
  res.writeHead = function withTiming(...args) {
    if (!res.headersSent) {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      res.setHeader('X-Response-Time', `${ms.toFixed(1)}ms`);
    }
    return writeHead.apply(this, args);
  };

  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    if (ms < config.logging.slowRequestMs) return;

    // A failed request is already in the error log with its stack. Recording it
    // here as well would list the same incident twice under two headings.
    if (res.statusCode >= 500) return;

    // The health check is polled by the watchdog every minute forever; a slow
    // one is the watchdog noticing, not a new fact.
    if (req.originalUrl?.includes('/health')) return;

    errorLogService.recordSlow({ req, ms });
  });

  next();
}

module.exports = slowRequest;
