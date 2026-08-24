const crypto = require('crypto');

const { prisma } = require('../../config/database');
const telegram = require('../alert/telegram');
const logger = require('../../utils/logger');
const { RULE_LABELS, RULE_SEVERITY, RULE_HELP } = require('./threat.rules');

/**
 * The record of everything that looked like an attack.
 *
 * ── One row per rule per address ────────────────────────────────────────────
 *
 * A scanner makes thousands of requests in a few minutes. A row for each would
 * mean the attack that ought to be reported is instead the thing that fills the
 * disk — an attack delivered through the system that reports attacks. So the
 * fingerprint is rule + address, repeats increment a counter, and one scanner
 * working through a wordlist is a handful of rows with large numbers on them.
 *
 * ── Never throws ────────────────────────────────────────────────────────────
 *
 * Recording runs inside the request path. A failure to write the record must
 * never become a failure of the request — the alternative is a logging bug that
 * an attacker can turn into an outage.
 *
 * ── What is stored of the payload ───────────────────────────────────────────
 *
 * A short slice, and nothing else. The point is to recognise the shape of the
 * attempt, not to keep a copy of it: a full payload is unbounded in size, and
 * storing megabytes of somebody's fuzzing is the same mistake in a different
 * place.
 */

/** How much of the offending input is kept. Enough to recognise, not to host. */
const SAMPLE_MAX = 300;

const fingerprintOf = (rule, ip) =>
  crypto.createHash('sha256').update(`${rule}|${ip}`).digest('hex').slice(0, 32);

/** Control characters out, length capped — the log must not become the problem. */
function safeSample(value) {
  return String(value === null || value === undefined ? '' : value)
    // Control characters out: a payload containing an escape sequence would
    // otherwise repaint the terminal of whoever tails the log, and a newline
    // would let it forge a second line.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .slice(0, SAMPLE_MAX);
}

const securityService = {
  /**
   * Record one detection.
   *
   * @param {object} event
   * @param {string} event.rule    one of the ids in threat.rules
   * @param {string} event.ip
   * @param {string} [event.sample] what matched
   * @param {string} [event.path]
   * @param {string} [event.method]
   * @param {string} [event.userAgent]
   * @param {string} [event.userId] if the attacker was signed in
   */
  async record({ rule, ip, sample, path, method, userAgent, userId }) {
    try {
      const address = ip || 'نامشخص';
      const fingerprint = fingerprintOf(rule, address);
      const severity = RULE_SEVERITY[rule] || 'medium';

      const row = await prisma.securityEvent.upsert({
        where: { fingerprint },
        create: {
          fingerprint,
          rule,
          severity,
          ip: address,
          sample: safeSample(sample),
          path: path ? String(path).slice(0, 300) : null,
          method: method || null,
          userAgent: userAgent ? String(userAgent).slice(0, 200) : null,
          userId: userId || null,
        },
        update: {
          count: { increment: 1 },
          lastSeen: new Date(),
          // Something that comes back was not dealt with, whatever anybody
          // ticked. The same rule the error log already follows.
          resolvedAt: null,
          // A recent example rather than the first one, so the row shows the
          // shape of what is arriving now. Not strictly the newest: a burst is
          // written concurrently and whichever upsert commits last wins. That
          // is fine — the value here is «this is the kind of thing they send»,
          // and the exact ordering of two payloads a millisecond apart is not
          // a question anybody asks.
          sample: safeSample(sample),
          path: path ? String(path).slice(0, 300) : undefined,
        },
      });

      await this.maybeAlert(row);
      return row;
    } catch (err) {
      logger.error('Could not record a security event', { error: err.message });
      return null;
    }
  },

  /**
   * When the phone should ring.
   *
   * On the first sighting, and then rarely. An attack is by nature repetitive,
   * and a channel that fires on every repetition is a channel that gets muted —
   * after which the alerting is worse than none, because everybody believes it
   * is working. Low-severity rules never alert at all: hitting a rate limit is
   * usually a stuck page, not an attacker.
   */
  async maybeAlert(row) {
    if (row.severity === 'low') return;
    if (row.count !== 1 && row.count % 100 !== 0) return;

    await telegram.send({
      level: row.severity === 'high' ? 'error' : 'warn',
      key: `sec-${row.fingerprint}`,
      title:
        row.count === 1
          ? `رویداد امنیتی: ${RULE_LABELS[row.rule] || row.rule}`
          : `رویداد امنیتی ادامه دارد (${row.count} بار)`,
      detail: [
        `آی‌پی: ${row.ip}`,
        row.path ? `مسیر: ${row.method || ''} ${row.path}` : null,
        row.sample ? `نمونه: ${row.sample.slice(0, 200)}` : null,
      ]
        .filter(Boolean)
        .join('\n'),
      help: RULE_HELP[row.rule],
    });
  },

  /**
   * The list, newest activity first.
   *
   * Ordered by `lastSeen` rather than by when it started: an attack that began
   * on Tuesday and is still running now belongs at the top.
   */
  async list({ resolved = false, rule, severity, ip, take = 50, skip = 0 } = {}) {
    const where = {
      ...(resolved ? { resolvedAt: { not: null } } : { resolvedAt: null }),
      ...(rule ? { rule } : {}),
      ...(severity ? { severity } : {}),
      ...(ip ? { ip } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.securityEvent.findMany({
        where,
        orderBy: { lastSeen: 'desc' },
        take,
        skip,
        include: { user: { select: { username: true, agencyName: true, agencyCode: true } } },
      }),
      prisma.securityEvent.count({ where }),
    ]);

    return {
      total,
      items: items.map((row) => ({
        ...row,
        label: RULE_LABELS[row.rule] || row.rule,
      })),
    };
  },

  /** A count per severity, for the header. One query, three numbers. */
  async summary() {
    const rows = await prisma.securityEvent.groupBy({
      by: ['severity'],
      where: { resolvedAt: null },
      _count: { _all: true },
    });
    const of = (level) => rows.find((r) => r.severity === level)?._count._all || 0;
    return { high: of('high'), medium: of('medium'), low: of('low') };
  },

  async get(id) {
    const row = await prisma.securityEvent.findUnique({
      where: { id },
      include: { user: { select: { username: true, agencyName: true, agencyCode: true } } },
    });
    if (!row) return null;

    // Everything this address has done, not only this rule — the useful
    // question about an attacker is what else they tried.
    const alsoFrom = await prisma.securityEvent.findMany({
      where: { ip: row.ip, id: { not: row.id } },
      orderBy: { lastSeen: 'desc' },
      take: 10,
      select: { id: true, rule: true, count: true, lastSeen: true, severity: true },
    });

    return {
      ...row,
      label: RULE_LABELS[row.rule] || row.rule,
      help: RULE_HELP[row.rule] || null,
      alsoFrom: alsoFrom.map((r) => ({ ...r, label: RULE_LABELS[r.rule] || r.rule })),
      blocked: await this.isBlocked(row.ip),
    };
  },

  resolve(id, note) {
    return prisma.securityEvent.update({
      where: { id },
      data: { resolvedAt: new Date(), note: note || null },
    });
  },

  // ── the block list ────────────────────────────────────────────────────────

  async isBlocked(ip) {
    const row = await prisma.blockedIp.findUnique({ where: { ip } });
    if (!row) return false;
    return !row.until || row.until > new Date();
  },

  /**
   * Close the door on one address.
   *
   * Manual only. Automatic blocking is the obvious next step and it is a trap:
   * the address comes from a header, so an attacker who can forge it can get
   * real agencies blocked — which turns the defence into the attack. A person
   * decides, always.
   */
  block({ ip, reason, days, byUserId }) {
    const until = days ? new Date(Date.now() + days * 24 * 60 * 60 * 1000) : null;
    return prisma.blockedIp.upsert({
      where: { ip },
      create: { ip, reason: reason || null, until, createdById: byUserId || null },
      update: { reason: reason || null, until, createdById: byUserId || null },
    });
  },

  unblock(ip) {
    return prisma.blockedIp.deleteMany({ where: { ip } });
  },

  blockedList() {
    return prisma.blockedIp.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
  },

  /** Addresses currently in force, for the middleware's cache. */
  async activeBlocks() {
    const rows = await prisma.blockedIp.findMany({
      where: { OR: [{ until: null }, { until: { gt: new Date() } }] },
      select: { ip: true },
    });
    return new Set(rows.map((r) => r.ip));
  },
};

module.exports = securityService;
module.exports.fingerprintOf = fingerprintOf;
