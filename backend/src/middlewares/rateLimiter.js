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
 * The general limit has to be sized for how the panel actually talks: one
 * dashboard view fires five to seven API calls, and an admin working through
 * reports can legitimately produce hundreds of requests in a quarter hour.
 * The first version allowed 100 — a working administrator hit it in about
 * fifteen clicks and the panel told them to go away.
 *
 * This limiter's job is stopping scripted abuse from one address, not
 * traffic shaping — flood defence belongs to nginx and the CDN in front.
 * Sign-in keeps its own tight limit below, because that is the endpoint
 * worth brute-forcing.
 */
const rateLimiter = rateLimit({
  windowMs: config.security.rateLimit.windowMs,
  max: config.security.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  message,
  skip: () => config.isTest,
});

// Auth endpoints get a far tighter limit: they are the ones worth brute forcing,
// and a legitimate user never needs dozens of login attempts in a few minutes.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message,
  skip: () => config.isTest,
});

module.exports = rateLimiter;
module.exports.authLimiter = authLimiter;
