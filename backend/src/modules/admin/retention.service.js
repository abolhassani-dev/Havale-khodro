const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const zlib = require('zlib');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

const { prisma } = require('../../config/database');
const config = require('../../config');
const logger = require('../../utils/logger');

/**
 * Keeping the audit trail from growing forever — without ever losing a row.
 *
 * ── Archive first, delete second ────────────────────────────────────────────
 *
 * Nothing is deleted straight out of the table. The rows that are due are
 * written to a compressed file, the file is counted, and only if the count
 * matches are they removed. If anything about the write fails, nothing is
 * deleted and tomorrow night tries again — the worst case is that pruning is a
 * day late, never that a record is gone with no copy of it.
 *
 * ── Why NDJSON and not a SQL dump ───────────────────────────────────────────
 *
 * The question asked six months later is «این نمایندگی خرداد چه کرد؟», and
 * answering it must not require standing up another database:
 *
 *   zcat /var/backups/feranocar/activity/*-1405-03-*.ndjson.gz \
 *     | jq 'select(.agencyCode == "TH-1042")'
 *
 * Each line therefore carries the agency's name and code, not only the user id.
 * The account may well have been deleted by then, and an id on its own resolves
 * to nothing.
 *
 * ── Deleting in batches ─────────────────────────────────────────────────────
 *
 * A single DELETE of a hundred thousand rows takes a lock long enough for
 * everyone on this server to feel it. Five thousand at a time, in a loop, is
 * slower in total and invisible to the people using the system — which is the
 * trade worth making on a machine this size.
 */

const BATCH = 5000;

/** How long each kind of entry stays in the table. */
function policy() {
  const { days } = config.retention;
  return [
    {
      name: 'ورود ناموفق',
      days: days.failedLogin,
      where: { action: 'LOGIN_FAILED' },
    },
    {
      name: 'ورود و خروج',
      days: days.auth,
      where: { action: { in: ['LOGIN', 'LOGOUT'] } },
    },
    {
      name: 'آگهی‌ها',
      days: days.listing,
      where: {
        action: {
          in: [
            'HAVALE_CREATED', 'HAVALE_UPDATED', 'HAVALE_RENEWED', 'HAVALE_FULFILLED',
            'HAVALE_DELETED', 'REGISTRATION_CREATED', 'REGISTRATION_UPDATED',
            'REGISTRATION_RENEWED', 'REGISTRATION_FULFILLED', 'REGISTRATION_DELETED',
          ],
        },
      },
    },
    {
      name: 'اقدامات مدیریتی و امنیتی',
      days: days.admin,
      // Everything not named above, and never CONTACT_REVEALED: that one is the
      // record the whole masking design exists to produce and it is kept for
      // good. Written as an exclusion rather than a list so a new admin action
      // is covered on the day it is added rather than on the day somebody
      // notices it was not.
      where: {
        action: {
          notIn: [
            'CONTACT_REVEALED', 'LOGIN', 'LOGOUT', 'LOGIN_FAILED',
            'HAVALE_CREATED', 'HAVALE_UPDATED', 'HAVALE_RENEWED', 'HAVALE_FULFILLED',
            'HAVALE_DELETED', 'REGISTRATION_CREATED', 'REGISTRATION_UPDATED',
            'REGISTRATION_RENEWED', 'REGISTRATION_FULFILLED', 'REGISTRATION_DELETED',
          ],
        },
      },
    },
  ];
}

const cutoff = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

/** `activity-2026-08-24.ndjson.gz` — sortable, and greppable by month. */
function archiveName(now) {
  const iso = now.toISOString().slice(0, 10);
  return `activity-${iso}.ndjson.gz`;
}

/**
 * One archived line.
 *
 * Flat on purpose: `jq 'select(.agencyCode == "…")'` should work without
 * anybody having to know the shape of a join.
 */
function toLine(row) {
  return {
    id: row.id,
    at: row.createdAt.toISOString(),
    action: row.action,
    userId: row.userId,
    // Denormalised deliberately — see the file header.
    agencyCode: row.user?.agencyCode || null,
    agencyName: row.user?.agencyName || null,
    fullName: row.user?.fullName || null,
    role: row.user?.role || null,
    targetType: row.targetType,
    targetId: row.targetId,
    summary: row.summary,
    changes: row.changes || null,
    ip: row.ip,
    device: row.device,
  };
}

const retentionService = {
  /**
   * Archive and prune everything that is due.
   *
   * @param {object} [opts]
   * @param {boolean} [opts.dryRun] count what would go, write and delete nothing
   * @returns {Promise<object>} a report — what was archived, what was removed
   */
  async run({ dryRun = false } = {}) {
    const now = new Date();
    const report = { at: now.toISOString(), dryRun, groups: [], archived: 0, deleted: 0 };

    for (const group of policy()) {
      const before = cutoff(group.days);
      const where = { ...group.where, createdAt: { lt: before } };

      // eslint-disable-next-line no-await-in-loop
      const due = await prisma.activityLog.count({ where });
      const entry = { name: group.name, days: group.days, due, archived: 0, deleted: 0 };
      report.groups.push(entry);

      if (!due || dryRun) continue;

      // eslint-disable-next-line no-await-in-loop
      entry.archived = await this.archive(where, now);
      if (entry.archived !== due) {
        // Counted, not assumed. A short file means rows arrived between the
        // count and the write, or the write was cut off — either way this is
        // the branch that refuses to delete on a maybe.
        logger.warn(
          `retention: ${group.name} — archived ${entry.archived} of ${due}, skipping the delete`
        );
        entry.skipped = true;
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      entry.deleted = await this.prune(where);
      report.archived += entry.archived;
      report.deleted += entry.deleted;
    }

    if (!dryRun) {
      report.archivesRemoved = await this.forgetOldArchives();
      report.errorsRemoved = await this.pruneResolvedErrors();
      report.securityRemoved = await this.pruneResolvedSecurityEvents();
    }

    return report;
  },

  /**
   * Write the matching rows to today's archive file.
   *
   * Streamed in pages rather than loaded at once: this runs on a machine with
   * under three gigabytes of memory, and «how many rows are due» is exactly the
   * number nobody can predict.
   */
  async archive(where, now) {
    const dir = config.retention.archiveDir;
    await fsp.mkdir(dir, { recursive: true });

    const target = path.join(dir, archiveName(now));
    // Appended to, not overwritten: several groups are archived on the same
    // night and each is a separate pass. Opening with 'w' would leave only the
    // last group's rows in the file — and the earlier ones would already have
    // been deleted from the table by then.
    const out = fs.createWriteStream(target, { flags: 'a' });
    let written = 0;
    let cursor = null;

    const rows = async function* rows() {
      for (;;) {
        const page = await prisma.activityLog.findMany({
          where,
          orderBy: { id: 'asc' },
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          take: 1000,
          include: {
            user: { select: { agencyCode: true, agencyName: true, fullName: true, role: true } },
          },
        });
        if (!page.length) return;
        for (const row of page) {
          written += 1;
          yield `${JSON.stringify(toLine(row))}\n`;
        }
        cursor = page[page.length - 1].id;
      }
    };

    await pipeline(Readable.from(rows()), zlib.createGzip(), out);
    return written;
  },

  /** Delete in batches, so no single statement holds a long lock. */
  async prune(where) {
    let removed = 0;

    for (;;) {
      // `deleteMany` has no limit, so the batch is chosen first and deleted by
      // id. Two statements instead of one, and the reason is the lock.
      // eslint-disable-next-line no-await-in-loop
      const batch = await prisma.activityLog.findMany({
        where,
        select: { id: true },
        take: BATCH,
      });
      if (!batch.length) return removed;

      // eslint-disable-next-line no-await-in-loop
      const { count } = await prisma.activityLog.deleteMany({
        where: { id: { in: batch.map((r) => r.id) } },
      });
      removed += count;
      if (count < BATCH) return removed;
    }
  },

  /** Archive files past their own lifetime. */
  async forgetOldArchives() {
    const dir = config.retention.archiveDir;
    const before = cutoff(config.retention.archiveDays);

    let names = [];
    try {
      names = await fsp.readdir(dir);
    } catch {
      // No directory yet means nothing has ever been archived. Not an error.
      return 0;
    }

    let removed = 0;
    for (const name of names) {
      const match = /^activity-(\d{4}-\d{2}-\d{2})\.ndjson\.gz$/.exec(name);
      if (!match) continue;
      if (new Date(match[1]) >= before) continue;
      // eslint-disable-next-line no-await-in-loop
      await fsp.unlink(path.join(dir, name)).catch(() => {});
      removed += 1;
    }
    return removed;
  },

  /**
   * Intrusion attempts somebody has already looked at.
   *
   * The open ones are never touched, however old: they are already collapsed to
   * one row per rule per address, so the table cannot grow the way a raw log
   * does, and an address that attacked once is worth recognising if it comes
   * back next year. Only what has been reviewed and closed ages out.
   */
  async pruneResolvedSecurityEvents() {
    const { count } = await prisma.securityEvent.deleteMany({
      where: {
        resolvedAt: { not: null, lt: cutoff(config.retention.days.resolvedSecurity) },
      },
    });
    return count;
  },

  /**
   * Errors somebody has already dealt with.
   *
   * Not archived: an error row is a stack trace and a count, reproducible from
   * the code, and nobody has ever asked what a resolved bug's trace looked like
   * three months ago.
   */
  async pruneResolvedErrors() {
    const { count } = await prisma.errorLog.deleteMany({
      where: {
        resolvedAt: { not: null, lt: cutoff(config.retention.days.resolvedErrors) },
      },
    });
    return count;
  },
};

module.exports = retentionService;
