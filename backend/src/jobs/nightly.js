#!/usr/bin/env node
/**
 * The nightly housekeeping run.
 *
 *   node src/jobs/nightly.js            # do it
 *   node src/jobs/nightly.js --dry-run  # say what it would do, change nothing
 *
 * Driven by cron on the host, the same way the backup and the certificate
 * renewal are — see deploy/nightly.sh. No long-running scheduler inside the API
 * process: a timer in there is a thing that silently stops when the container
 * restarts, and nobody notices for a month.
 *
 * Every step is independent and a failure in one does not stop the next: a
 * failed archive must not also stop the error table from being tidied. The run
 * ends by saying what it did, because a housekeeping job that fails quietly is
 * worse than no housekeeping job at all — the disk fills while the logs say
 * nothing.
 */
const { connectDatabase, disconnectDatabase } = require('../config/database');
const retentionService = require('../modules/admin/retention.service');
const telegram = require('../modules/alert/telegram');
const logger = require('../utils/logger');
const { toPersianDigits } = require('../utils/persian');

const dryRun = process.argv.includes('--dry-run');

/** The report, as a person reads it. */
function summarise(report) {
  const lines = report.groups.map((g) => {
    const head = `${g.name} (نگهداری ${toPersianDigits(g.days)} روز)`;
    if (!g.due) return `• ${head}: چیزی برای پاک کردن نبود`;
    if (report.dryRun) return `• ${head}: ${toPersianDigits(g.due)} ردیف آماده‌ی آرشیو`;
    if (g.skipped) {
      return `• ${head}: ⚠ آرشیو ناقص بود (${toPersianDigits(g.archived)} از ${toPersianDigits(g.due)}) — چیزی پاک نشد`;
    }
    return `• ${head}: ${toPersianDigits(g.archived)} ردیف آرشیو و پاک شد`;
  });

  if (report.archivesRemoved) {
    lines.push(`• ${toPersianDigits(report.archivesRemoved)} فایل آرشیو قدیمی حذف شد`);
  }
  if (report.errorsRemoved) {
    lines.push(`• ${toPersianDigits(report.errorsRemoved)} خطای رسیدگی‌شده پاک شد`);
  }
  return lines.join('\n');
}

async function main() {
  await connectDatabase();

  let report;
  try {
    report = await retentionService.run({ dryRun });
  } finally {
    await disconnectDatabase();
  }

  const text = summarise(report);
  logger.info(`nightly: ${JSON.stringify(report)}`);
  process.stdout.write(`${text}\n`);

  // Told, not merely logged — but only when something actually happened or
  // went wrong. A message every night that says «چیزی برای پاک کردن نبود» is
  // a message people stop reading, and then they stop reading the one that
  // matters too.
  const failed = report.groups.some((g) => g.skipped);
  if (!dryRun && (failed || report.deleted)) {
    await telegram.send({
      title: failed ? 'پاک‌سازی شبانه ناقص ماند' : 'پاک‌سازی شبانه‌ی لاگ',
      detail: text,
      level: failed ? 'error' : 'info',
      key: 'nightly-retention',
    });
  }

  return failed ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    logger.error(`nightly failed: ${err.stack || err.message}`);
    process.stderr.write(`✗ ${err.message}\n`);
    process.exit(1);
  });
