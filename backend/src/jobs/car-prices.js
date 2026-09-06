#!/usr/bin/env node
/**
 * The hourly price fetch.
 *
 *   node src/jobs/car-prices.js                       # both groups, write
 *   node src/jobs/car-prices.js --dry-run             # fetch, parse, judge — write nothing
 *   node src/jobs/car-prices.js --group DOMESTIC      # one group
 *   node src/jobs/car-prices.js --file page.html --group IMPORTED   # a saved page instead of the network
 *
 * Driven by cron on the host (deploy/car-prices.sh), like the nightly run and
 * for the same reason: a timer inside the API process dies with the container
 * and nobody notices for a month; a cron entry is visible in one command.
 *
 * Two requests an hour, one after the other, never in parallel. Each group is
 * its own decision: a broken imported page must not stop the domestic list
 * from updating, and vice versa.
 */
const fs = require('fs');
const { connectDatabase, disconnectDatabase } = require('../config/database');
const carPriceService = require('../modules/carprice/carprice.service');
const telegram = require('../modules/alert/telegram');
const logger = require('../utils/logger');
const { toPersianDigits } = require('../utils/persian');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};

const dryRun = flag('--dry-run');
const only = value('--group');
const file = value('--file');

const LABEL = { DOMESTIC: 'تولید داخل', IMPORTED: 'وارداتی' };

async function main() {
  const groups = only ? [only] : carPriceService.GROUPS;
  if (file && !only) {
    throw new Error('--file needs --group: which page is this?');
  }
  const html = file ? fs.readFileSync(file, 'utf8') : null;

  await connectDatabase();
  const lines = [];
  let failed = false;

  try {
    for (const group of groups) {
      try {
        // Sequential on purpose — see the header.
        // eslint-disable-next-line no-await-in-loop
        const r = await carPriceService.refresh(group, { html, dryRun });
        lines.push(
          `• ${LABEL[group] || group}: ${toPersianDigits(r.items)} ردیف` +
            (r.changed ? `، ${toPersianDigits(r.changed)} تغییر قیمت` : '') +
            (r.newItems ? `، ${toPersianDigits(r.newItems)} ردیف تازه` : '') +
            (dryRun ? ' (فقط بررسی)' : '')
        );
      } catch (err) {
        failed = true;
        lines.push(`• ${LABEL[group] || group}: ✗ ${err.message}`);
        logger.error(`car prices: ${group} failed: ${err.stack || err.message}`);
      }
    }
  } finally {
    await disconnectDatabase();
  }

  const text = lines.join('\n');
  process.stdout.write(`${text}\n`);

  // Told only when something is wrong. A message every hour that says «۱۱۵
  // ردیف» is a message nobody reads — and then nobody reads the one that says
  // the list has been stale since morning either. The cooldown inside
  // telegram.send keeps a source that is down all night to a few messages.
  if (failed && !dryRun) {
    await telegram.send({
      title: 'قیمت روز خودرو به‌روز نشد',
      detail: `${text}\n\nفهرست قبلی با تاریخ خودش سر جایش است.`,
      help: 'اگر چند ساعت ادامه داشت: صفحه‌ی منبع را در مرورگر باز کنید — اگر قالبش عوض شده، پارسر باید به‌روز شود (tests/fixtures/car-prices).',
      level: 'error',
      key: 'car-prices',
    });
  }

  return failed ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    logger.error(`car prices job failed: ${err.stack || err.message}`);
    process.stderr.write(`✗ ${err.message}\n`);
    process.exit(1);
  });
