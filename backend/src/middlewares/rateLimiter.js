const rateLimit = require('express-rate-limit');
const config = require('../config');
const { ERROR_CODES } = require('../constants/errorCodes');
const { threats } = require('./threatDetect');

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
 * How many processes share this budget.
 *
 * The counters live in this process's memory, and with several workers each
 * keeps its own. Left alone, running two workers would quietly double every
 * limit in this file — including the ten wrong passwords that are the whole
 * brute-force defence. Requests are spread across the workers, so each one
 * gets its share of the budget and the total stays what the operator asked
 * for. Set by server.js when it forks; absent means one process.
 */
const WORKERS = Math.max(Number(process.env.CLUSTER_WORKERS) || 1, 1);

/** A global budget, as this one process is allowed to count it. */
function share(total, floor) {
  return Math.max(Math.round(total / WORKERS), floor);
}

/**
 * Per session where possible, per address otherwise.
 *
 * The cookie is used only as a bucket label — nothing is trusted about it and
 * no authorisation decision depends on it, so reading it before the auth
 * middleware is safe. What it must not be is the *only* budget: a client that
 * invents a new cookie value for every request would otherwise get a fresh
 * allowance every time, and this limiter would count nothing at all. So the
 * address keeps its own, larger ceiling below — wide enough that an office
 * full of agencies behind one connection never reaches it, and low enough
 * that a script rotating cookies still runs out.
 */
function keyFor(req) {
  const sid = req.cookies?.[config.session.cookieName];
  return sid ? `s:${sid.slice(0, 24)}` : `ip:${req.ip}`;
}

/** How many sessions' worth of traffic one address may carry. */
const ADDRESS_MULTIPLIER = 5;

/**
 * What to do when somebody is turned away.
 *
 * A single rejection is ordinary — a stuck page retrying, a phone on a bad
 * connection. Twenty in ten minutes from one address is a script, so the
 * counter in threatDetect decides which of the two this is and only records the
 * second. The response itself is unchanged: this is a note in a log, not a
 * different answer.
 */
function onLimited(req, res, _next, options) {
  threats.throttled(req);
  res.status(options.statusCode).json(options.message);
}

// A floor, deliberately. `.env` files outlive the advice that produced them,
// and the value this project shipped with first — 100 — cannot serve a
// working panel: one dashboard view is five to seven calls. A server whose
// .env still says 100 would otherwise keep locking people out with no sign
// that the number is the reason.
const SESSION_BUDGET = share(Math.max(Number(config.security.rateLimit.max) || 0, 600), 300);

const skipExempt = (req) =>
  config.isTest ||
  // The health route is polled by the container healthcheck every thirty
  // seconds and by update.sh in a loop. Counting those against a human's
  // budget is how a system reports itself down for being watched.
  req.path === '/api/v1/health';

const perSession = rateLimit({
  handler: onLimited,
  windowMs: config.security.rateLimit.windowMs,
  max: SESSION_BUDGET,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyFor,
  message,
  skip: skipExempt,
});

// The address ceiling. No headers of its own: the per-session limiter's
// RateLimit-* headers are the ones a well-behaved client should read, and two
// sets on one response would only contradict each other.
const perAddress = rateLimit({
  handler: onLimited,
  windowMs: config.security.rateLimit.windowMs,
  max: SESSION_BUDGET * ADDRESS_MULTIPLIER,
  standardHeaders: false,
  legacyHeaders: false,
  keyGenerator: (req) => `ip:${req.ip}`,
  message,
  skip: skipExempt,
});

function rateLimiter(req, res, next) {
  perAddress(req, res, (err) => (err ? next(err) : perSession(req, res, next)));
}

/**
 * Sign-in, where the limit exists to stop guessing.
 *
 * Only failures count, so a real person can sign in as often as they like and
 * a script gets ten wrong guesses per quarter hour. Two buckets, because one
 * was not enough:
 *
 *   Per address *and* username — so someone attacking one account cannot lock
 *   out everyone else who happens to share an address with them.
 *
 *   Per address alone — because with only the first bucket, a script trying
 *   a different username on every request got a fresh allowance each time,
 *   and fifteen sprayed guesses were all accepted. Twelve failures from one
 *   address in a quarter hour is far more than an office of real people
 *   produces (successes never count), and far less than a spray needs.
 */
const authMessage = {
  success: false,
  error: {
    code: ERROR_CODES.RATE_LIMITED,
    message:
      'تلاش‌های ناموفق زیاد بود. حساب برای مدت کوتاهی قفل است — چند دقیقه صبر کنید.',
  },
};

const perAccountAuth = rateLimit({
  handler: onLimited,
  windowMs: 15 * 60 * 1000,
  // Five per worker rather than ten in one place: a person who has forgotten
  // their password still gets several tries, and a script still runs out.
  max: share(10, 5),
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.ip}|${String(req.body?.username || '').toLowerCase().slice(0, 40)}`,
  message: authMessage,
  skip: () => config.isTest,
});

const perAddressAuth = rateLimit({
  handler: onLimited,
  windowMs: 15 * 60 * 1000,
  max: share(12, 6),
  skipSuccessfulRequests: true,
  standardHeaders: false,
  legacyHeaders: false,
  keyGenerator: (req) => `auth:${req.ip}`,
  message: authMessage,
  skip: () => config.isTest,
});

function authLimiter(req, res, next) {
  perAddressAuth(req, res, (err) => (err ? next(err) : perAccountAuth(req, res, next)));
}

module.exports = rateLimiter;
module.exports.authLimiter = authLimiter;
