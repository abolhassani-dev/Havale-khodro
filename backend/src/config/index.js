/**
 * Single source of configuration.
 *
 * Everything reads the environment here and nowhere else, so one file answers
 * "what does a deployment of this service actually need?". Required values are
 * checked at boot — a missing secret should stop the process immediately rather
 * than surface later as a confusing runtime failure.
 */

const required = ['SESSION_SECRET', 'DATABASE_URL'];

const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
}

const env = process.env.NODE_ENV || 'development';

module.exports = {
  env,
  isProduction: env === 'production',
  isTest: env === 'test',
  port: Number(process.env.PORT) || 3000,
  apiPrefix: process.env.API_PREFIX || '/api/v1',

  database: {
    url: process.env.DATABASE_URL,
  },

  session: {
    // Sessions live in the database rather than in a signed token, because one
    // session per account (blueprint 3.3) requires server-side state that can be
    // revoked. A self-contained JWT cannot be taken back once issued.
    secret: process.env.SESSION_SECRET,
    cookieName: process.env.SESSION_COOKIE_NAME || 'havale_session',
    ttlMs: Number(process.env.SESSION_TTL_HOURS || 12) * 60 * 60 * 1000,
  },

  security: {
    bcryptRounds: Number(process.env.BCRYPT_ROUNDS) || 10,
    corsOrigins: (process.env.CORS_ORIGINS || '*').split(',').map((s) => s.trim()),
    bodyLimit: process.env.BODY_LIMIT || '1mb',
    rateLimit: {
      windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
      max: Number(process.env.RATE_LIMIT_MAX) || 100,
    },
  },

  logging: {
    level: process.env.LOG_LEVEL || 'info',
  },
};
