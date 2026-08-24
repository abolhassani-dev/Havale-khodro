const crypto = require('crypto');
const { prisma } = require('../../config/database');
const logger = require('../../utils/logger');
const telegram = require('./telegram');

/**
 * Errors, recorded where a developer can actually read them.
 *
 * A log file needs SSH, a path, and somebody who already suspects something is
 * wrong. This table needs a browser. It answers the three questions that
 * actually get asked — what broke, how often, and when it last happened — and
 * it does it without giving anyone shell access to a production machine.
 *
 * Identical errors collapse onto one row by fingerprint. A single bug firing
 * five thousand times must not bury the other four.
 */

/**
 * What makes two errors "the same".
 *
 * The message and the first line of the stack, with digits and ids stripped:
 * "listing cm4x7 not found" and "listing cm9z2 not found" are one bug, and
 * fingerprinting them separately turns the page into noise.
 */
function fingerprintOf(err, path) {
  const message = String(err.message || err)
    .replace(/\b[0-9a-f]{20,}\b/gi, ':id')
    .replace(/\d+/g, ':n');
  const frame = String(err.stack || '')
    .split('\n')
    .find((line) => line.includes('/src/') && !line.includes('node_modules')) || '';
  const route = String(path || '').replace(/\/[0-9a-z]{20,}/gi, '/:id');

  return crypto
    .createHash('sha256')
    .update(`${message}|${frame.trim()}|${route}`)
    .digest('hex')
    .slice(0, 32);
}

/**
 * How to start debugging this. Shown in the panel and sent with the alert.
 *
 * Generic advice would be worthless; these are the failures this system has
 * actually produced, and what each one turned out to be.
 */
function helpFor(err) {
  const text = `${err.message || ''} ${err.code || ''}`;

  if (/Can't reach database server|ECONNREFUSED.*5432|PrismaClientInitialization/i.test(text)) {
    return 'پایگاه داده در دسترس نیست. روی سرور: docker compose ps — اگر db بالا نیست، docker compose up -d db و بعد docker compose logs db --tail 50';
  }
  if (/Unique constraint failed/i.test(text)) {
    return 'یک مقدار تکراری ثبت شده (نام کاربری، کد نمایندگی یا شماره). فیلد در متن خطا آمده — اعتبارسنجی ورودی باید قبلش می‌گرفت.';
  }
  if (/Foreign key constraint/i.test(text)) {
    return 'ارجاع به رکوردی که وجود ندارد یا حذف شده. معمولاً یعنی چیزی حذف شده و جایی هنوز به آن اشاره می‌کند.';
  }
  if (/Do not know how to serialize a BigInt/i.test(text)) {
    return 'یک ستون مبلغ مستقیم در پاسخ JSON گذاشته شده. مبالغ باید با String() یا Number() از مرز JSON رد شوند — نمونه: havale.dto.js';
  }
  if (/timeout|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/i.test(text)) {
    return 'شبکه‌ی بیرون از سرور جواب نداد (DNS یا اتصال). اگر تکرار شد: docker compose exec api getent hosts <میزبان>';
  }
  if (/ENOSPC|no space left/i.test(text)) {
    return 'دیسک پر شده. df -h و بعد پاک کردن بکاپ‌های قدیمی یا docker system prune -a --volumes (اول بکاپ بگیرید).';
  }
  if (/decrypt|DATA_ENCRYPTION_KEY/i.test(text)) {
    return 'کلید رمزنگاری عوض شده یا غایب است. DATA_ENCRYPTION_KEY در .env باید همانی باشد که داده با آن نوشته شده — با کلید اشتباه، شماره‌ها خوانده نمی‌شوند.';
  }
  return 'لاگ کامل: docker compose logs api --tail 100 — و همین‌جا، در «لاگ فنی»، متن و محل دقیق هست.';
}

const errorLogService = {
  /**
   * Records an error. Never throws — a failure to log must not become a second
   * failure on top of the first.
   */
  async record(err, req) {
    try {
      const fingerprint = fingerprintOf(err, req?.originalUrl);
      const help = helpFor(err);

      const row = await prisma.errorLog.upsert({
        where: { fingerprint },
        create: {
          fingerprint,
          message: String(err.message || err).slice(0, 500),
          stack: err.stack ? String(err.stack).slice(0, 4000) : null,
          path: req?.originalUrl?.slice(0, 300) || null,
          method: req?.method || null,
          statusCode: err.statusCode || 500,
          requestId: req?.id || null,
          userId: req?.user?.id || null,
        },
        update: {
          count: { increment: 1 },
          lastSeen: new Date(),
          // A resolved error that happens again is not resolved.
          resolvedAt: null,
          stack: err.stack ? String(err.stack).slice(0, 4000) : undefined,
        },
      });

      // Alert on the first occurrence and then at intervals, not on every one.
      // The dedup key is the fingerprint, so one loud bug is one message.
      if (row.count === 1 || row.count % 50 === 0) {
        await telegram.send({
          level: 'error',
          key: fingerprint,
          title: row.count === 1 ? 'خطای جدید در سامانه' : `خطای تکراری (${row.count} بار)`,
          detail: `${err.message}\n${req?.method || ''} ${req?.originalUrl || ''}`,
          help,
        });
      }

      return row;
    } catch (loggingError) {
      logger.error('Could not record error', { error: loggingError.message });
      return null;
    }
  },

  /**
   * A request that took too long.
   *
   * Collapsed by route rather than by exact path, so `/havales/cm4x7…` and
   * `/havales/cm9z2…` are one entry — otherwise every listing anybody opened
   * slowly would be its own row and the page would be unreadable within a day.
   *
   * `durationMs` keeps the *worst* time seen, not the latest: the answer to
   * "how bad does this get?" is the one that matters, and the last sample is
   * whichever happened to be most recent.
   */
  async recordSlow({ req, ms }) {
    try {
      const route = String(req.originalUrl || '')
        .split('?')[0]
        .replace(/\/[0-9a-z]{20,}/gi, '/:id')
        .slice(0, 300);
      const method = req.method || 'GET';
      const fingerprint = crypto
        .createHash('sha256')
        .update(`slow|${method}|${route}`)
        .digest('hex')
        .slice(0, 32);
      const worst = Math.round(ms);

      await prisma.errorLog.upsert({
        where: { fingerprint },
        create: {
          fingerprint,
          level: 'slow',
          message: `${method} ${route}`,
          path: route,
          method,
          durationMs: worst,
          statusCode: null,
          requestId: req.id || null,
          userId: req.user?.id || null,
        },
        update: {
          count: { increment: 1 },
          lastSeen: new Date(),
          // Only when it is actually worse. Prisma has no `GREATEST`, so the
          // comparison happens here and a slower-than-recorded sample is the
          // only thing that moves the number.
          ...(await this.worseThan(fingerprint, worst)),
        },
      });
    } catch {
      // Recording that something was slow must never be the reason a request
      // fails. Silence is correct here.
    }
  },

  /** `{ durationMs }` when this sample is the worst so far, otherwise `{}`. */
  async worseThan(fingerprint, ms) {
    const row = await prisma.errorLog.findUnique({
      where: { fingerprint },
      select: { durationMs: true },
    });
    return !row || ms > (row.durationMs || 0) ? { durationMs: ms } : {};
  },

  async list({ resolved = false, level = 'error', take = 50, skip = 0 } = {}) {
    const where = {
      // Errors and slow requests share a table and a fingerprint, and must not
      // share a list: a stack trace and a slow route are different jobs on
      // different days.
      level: level === 'slow' ? 'slow' : { not: 'slow' },
      ...(resolved ? { resolvedAt: { not: null } } : { resolvedAt: null }),
    };
    const [items, total] = await Promise.all([
      prisma.errorLog.findMany({
        where,
        orderBy: { lastSeen: 'desc' },
        take,
        skip,
        include: { user: { select: { username: true, agencyName: true } } },
      }),
      prisma.errorLog.count({ where }),
    ]);
    return { items, total };
  },

  async get(id) {
    const row = await prisma.errorLog.findUnique({
      where: { id },
      include: { user: { select: { username: true, agencyName: true } } },
    });
    return row ? { ...row, help: helpFor({ message: row.message }) } : null;
  },

  async resolve(id, note) {
    return prisma.errorLog.update({
      where: { id },
      data: { resolvedAt: new Date(), note: note || null },
    });
  },

  helpFor,
  fingerprintOf,
};

module.exports = errorLogService;
