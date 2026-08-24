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
      // ~80/min per IP. A working panel view is 5-7 calls; 100 per window
      // locked an ordinary admin out after a few pages (see rateLimiter.js).
      max: Number(process.env.RATE_LIMIT_MAX) || 1200,
    },
  },

  sms: {
    // The default for the runtime switch, used until a value is stored in the
    // settings table. Off, because there is no panel yet and a system that
    // demands a code it cannot deliver locks everyone out.
    enabled: process.env.SMS_ENABLED === 'true',
    driver: process.env.SMS_DRIVER || 'log',
    apiKey: process.env.SMS_API_KEY || null,
    sender: process.env.SMS_SENDER || null,
  },

  alerts: {
    // Monitoring that reaches a phone. Absent token or chat id means alerting
    // is simply off — the application must never depend on it, and from Iran
    // Telegram is regularly unreachable.
    telegram: {
      token: process.env.TELEGRAM_BOT_TOKEN || null,
      chatId: process.env.TELEGRAM_CHAT_ID || null,
    },
  },

  logging: {
    level: process.env.LOG_LEVEL || 'info',
    // Above this, a request is recorded as slow. Measured p95 on this hardware
    // is around 370ms, so 1200 is «something is wrong» rather than «busy» —
    // set it lower for a while if you are hunting something specific.
    slowRequestMs: Number(process.env.SLOW_REQUEST_MS || 1200),
  },

  /**
   * How long the audit trail stays in the database, and where the rows go
   * before they are removed.
   *
   * The directory is deliberately outside the project: `deploy/update.sh`
   * brings the project directory back in line with the repository on every
   * update, so an archive kept in there would disappear one evening as a side
   * effect of deploying. `deploy/backup.sh` picks this path up so the archive
   * travels with the rest of the server.
   *
   * The days are settings rather than constants because the right number is a
   * business decision — how long an argument about a listing can plausibly
   * arrive — and it should not need a deploy to change.
   */
  retention: {
    archiveDir: process.env.ACTIVITY_ARCHIVE_DIR || '/archive',
    archiveDays: Number(process.env.ACTIVITY_ARCHIVE_DAYS || 365),
    // Per family of action. Contact reveals are not here at all: they are the
    // record the whole masking design exists to produce, and they are kept.
    days: {
      auth: Number(process.env.RETAIN_AUTH_DAYS || 90),
      failedLogin: Number(process.env.RETAIN_FAILED_LOGIN_DAYS || 30),
      listing: Number(process.env.RETAIN_LISTING_DAYS || 365),
      admin: Number(process.env.RETAIN_ADMIN_DAYS || 730),
      resolvedErrors: Number(process.env.RETAIN_RESOLVED_ERROR_DAYS || 90),
      // Longer than an error, because the question «has this address bothered
      // us before?» is asked over a much longer span. Open events are never
      // deleted at all — they are one row per rule per address, so they cannot
      // grow the way a raw log does.
      resolvedSecurity: Number(process.env.RETAIN_RESOLVED_SECURITY_DAYS || 180),
    },
  },
};
