const rateLimit = require('express-rate-limit');
const config = require('../config');
const { ERROR_CODES } = require('../constants/errorCodes');

const message = {
  success: false,
  error: { code: ERROR_CODES.RATE_LIMITED, message: 'Too many requests, try again later' },
};

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
