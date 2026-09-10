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
    // Empty means no cross-origin caller at all — which is the normal state:
    // the panel is served from the same origin as the API and needs no CORS
    // header. `*` is refused outright rather than passed along, because with
    // credentials it is either ignored by the browser or, with a library
    // change, a door for every site on the internet.
    corsOrigins: (process.env.CORS_ORIGINS || '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s && s !== '*'),
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
    // is simply off — the application must never depend on it.
    //
    // The messages go to whichever Bot API `ALERT_API_BASE` names. Bale by
    // default (tapi.bale.ai), which speaks Telegram's Bot API word for word
    // and is reachable from inside Iran, where Telegram itself is not. The
    // variable names keep their TELEGRAM_ prefix so existing .env files keep
    // working; deploy/notify.sh reads the same three values.
    telegram: {
      token: process.env.TELEGRAM_BOT_TOKEN || null,
      chatId: process.env.TELEGRAM_CHAT_ID || null,
      apiBase: (process.env.ALERT_API_BASE || 'https://tapi.bale.ai').replace(/\/+$/, ''),
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
      // One-time codes and the SMS delivery log: both carry telephone
      // numbers, neither is worth keeping past the time a support question
      // about them could still come in.
      otp: Number(process.env.RETAIN_OTP_DAYS || 30),
      sms: Number(process.env.RETAIN_SMS_DAYS || 90),
      // Price points: one per change plus one a day, so a year is a few
      // thousand rows per car at most. Long, because the trend chart that
      // will read them is worth more the further back it can look.
      carPriceHistory: Number(process.env.RETAIN_CAR_PRICE_HISTORY_DAYS || 400),
    },
  },

  carPrices: {
    // Where the hourly job (src/jobs/car-prices.js) reads the market price
    // list. Two pages, one per group; nothing in the request path ever
    // touches them — agencies read the snapshot in the database.
    sources: {
      DOMESTIC:
        process.env.CAR_PRICES_URL_DOMESTIC ||
        'https://www.iranjib.ir/showgroup/45/%D9%82%DB%8C%D9%85%D8%AA-%D8%AE%D9%88%D8%AF%D8%B1%D9%88-%D8%AA%D9%88%D9%84%DB%8C%D8%AF-%D8%AF%D8%A7%D8%AE%D9%84/',
      IMPORTED:
        process.env.CAR_PRICES_URL_IMPORTED ||
        'https://www.iranjib.ir/showgroup/46/%D9%82%DB%8C%D9%85%D8%AA-%D8%AE%D9%88%D8%AF%D8%B1%D9%88-%D9%88%D8%A7%D8%B1%D8%AF%D8%A7%D8%AA%DB%8C/',
    },
    timeoutMs: Number(process.env.CAR_PRICES_TIMEOUT_MS || 20000),
    // Says who is asking, the way a polite crawler does. Overridable in case
    // the source only answers browsers.
    userAgent:
      process.env.CAR_PRICES_USER_AGENT ||
      'Mozilla/5.0 (compatible; FeranoCar/1.0; +https://feranocar.com)',
    // Below this many rows the page is not the price list — a maintenance
    // page, a block page, a redesign — and the previous snapshot stays.
    minItems: Number(process.env.CAR_PRICES_MIN_ITEMS || 20),
    // «به‌روزرسانی با تأخیر» past this, on the page and in the API.
    staleAfterMs: Number(process.env.CAR_PRICES_STALE_MS || 3 * 60 * 60 * 1000),
    // A row not seen for this long falls out of the list (kept, not deleted).
    dropAfterMs: Number(process.env.CAR_PRICES_DROP_MS || 7 * 24 * 60 * 60 * 1000),
    // How many cars an agency may star.
    watchLimit: Number(process.env.CAR_PRICES_WATCH_LIMIT || 30),
    // How long to stay quiet after telling someone the fetch is broken.
    //
    // The job runs four times an hour in a container of its own, so the
    // in-process cooldown inside telegram.send never sees the previous run:
    // without this, a source that is down overnight sends a notification
    // every fifteen minutes, and the message that matters drowns in them.
    // The first failure after a good run still goes out at once.
    alertCooldownMs: Number(process.env.CAR_PRICES_ALERT_COOLDOWN_MS || 3 * 60 * 60 * 1000),
  },
};
