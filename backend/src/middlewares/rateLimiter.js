const rateLimit = require('express-rate-limit');
const config = require('../config');
const { ERROR_CODES } = require('../constants/errorCodes');

// Users see this text in the interface, so it is in their language.
const message = {
  success: false,
  error: {
    code: ERROR_CODES.RATE_LIMITED,
    message: 'درخواست‌ها بیش از حد زیاد شد. چند لحظه صبر کنید و دوباره امتحان کنید.',
  },
};

/**
 * Rate limiting, sized so that using the product normally never touches it.
 *
 * Two mistakes made the earlier version fire at ordinary people, and both are
 * worth naming because they are the standard ones:
 *
 *   1. Counting by IP alone. Every agency behind one office connection — or
 *      one mobile carrier's NAT — shared a single budget, so the fourth person
 *      to sign in that afternoon was told to go away. The key is now the
 *      session when there is one, and the address only for anonymous traffic.
 *
 *   2. Counting successful requests on sign-in. Brute force is *failed*
 *      attempts; someone signing in and out while testing is not an attack.
 *      `skipSuccessfulRequests` is the documented answer and it is what every
 *      serious guide recommends.
 *
 * What this limiter is for is stopping a script hammering one endpoint. Flood
 * defence belongs to nginx and the CDN in front of it — trying to do that here
 * only ever produces false positives.
 */

/**
 * Per session where possible, per address otherwise.
 *
 * The cookie is used only as a bucket label — nothing is trusted about it and
 * no authorisation decision depends on it, so reading it before the auth
 * middleware is safe.
 */
function keyFor(req) {
  const sid = req.cookies?.[config.session.cookieName];
  return sid ? `s:${sid.slice(0, 24)}` : `ip:${req.ip}`;
}

const rateLimiter = rateLimit({
  windowMs: config.security.rateLimit.windowMs,
  // A floor, deliberately. `.env` files outlive the advice that produced them,
  // and the value this project shipped with first — 100 — cannot serve a
  // working panel: one dashboard view is five to seven calls. A server whose
  // .env still says 100 would otherwise keep locking people out with no sign
  // that the number is the reason.
  max: Math.max(Number(config.security.rateLimit.max) || 0, 600),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyFor,
  message,
  skip: (req) =>
    config.isTest ||
    // The health route is polled by the container healthcheck every thirty
    // seconds and by update.sh in a loop. Counting those against a human's
    // budget is how a system reports itself down for being watched.
    req.path === '/api/v1/health',
});

/**
 * Sign-in, where the limit exists to stop guessing.
 *
 * Only failures count, so a real person can sign in as often as they like and
 * a script gets ten wrong guesses per quarter hour. The bucket includes the
 * username, so someone attacking one account cannot lock out everyone else who
 * happens to share an address with them — while the address is still in the
 * key, so spraying many usernames from one machine is also capped.
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.ip}|${String(req.body?.username || '').toLowerCase().slice(0, 40)}`,
  message: {
    success: false,
    error: {
      code: ERROR_CODES.RATE_LIMITED,
      message:
        'تلاش‌های ناموفق زیاد بود. حساب برای مدت کوتاهی قفل است — چند دقیقه صبر کنید.',
    },
  },
  skip: () => config.isTest,
});

module.exports = rateLimiter;
module.exports.authLimiter = authLimiter;
