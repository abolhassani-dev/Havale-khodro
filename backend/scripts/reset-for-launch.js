/* eslint-disable no-console */
//
// Console rather than the logger, on purpose: the person running this is the
// owner at a terminal on launch day, and the output *is* the interface.
require('dotenv').config();

const fs = require('fs');
const path = require('path');

const { prisma, connectDatabase, disconnectDatabase } = require('../src/config/database');
const { ROLES } = require('../src/constants/roles');

/**
 * Wipes everything the trial period produced, and nothing the product needs.
 *
 *   docker compose exec -T api node scripts/reset-for-launch.js            # shows what would go
 *   docker compose exec -T api node scripts/reset-for-launch.js --apply    # does it
 *
 * The day before the first real agency signs in, the database is full of
 * demo agencies, sample advertisements, test tickets and a few hundred lines
 * of activity from people clicking around. None of that may be there when a
 * real dealership opens the panel: a market with fake offers in it is a market
 * nobody trusts, and a ticket queue numbered from 37 is a queue that says
 * «others were here first».
 *
 * What goes: every agency account (role AGENT) and everything that hangs off
 * it — advertisements in all three markets with their photos, contact
 * reveals, violation reports, tickets with their attachments, seat orders
 * with their receipts, subscriptions, sessions, OTP codes, SMS history, the
 * activity log — and the uploaded files those rows pointed at. Serial numbers
 * (ticket #, report #, order #, advertisement #) start again from 1.
 *
 * What stays, deliberately: every staff account (owner, administrators,
 * support, finance — anyone who is not an agency), the subscription plans,
 * the runtime settings, the whole car catalogue (companies, brands, models,
 * colours), the daily-price snapshot with its history, and the error and
 * security logs. Those last two are the record of what the *server* went
 * through, not what the demo accounts did; a scanner that probed the site
 * last week is still worth knowing about tomorrow.
 *
 * Why a dry run is the default: this is the one script in the repository
 * that cannot be undone by running something else afterwards. Reading the
 * counts first, then typing `--apply`, costs ten seconds and has saved a
 * database more than once elsewhere. Take a backup before `--apply` anyway —
 * `./deploy/backup.sh daily` on the host.
 *
 * Why it refuses while SEED_DEMO or ALLOW_DEMO_SEED is on: the container's
 * entrypoint re-creates the demo agencies on the next restart when SEED_DEMO
 * is true. Wiping them with that switch still on means the next deploy puts
 * them straight back — with the password that is written in this repository.
 */

/** Upload folders, by the uploader that fills them. After the wipe nothing references a file in any of them. */
const UPLOAD_SUBDIRS = ['cars', 'tickets', 'receipts'];

/** Tables whose serial numbers restart, so the first real ticket is ticket 1. */
const SERIAL_TABLES = ['Listing', 'Ticket', 'ViolationReport', 'SeatOrder'];

function demoSwitchesOn(env = process.env) {
  return ['SEED_DEMO', 'ALLOW_DEMO_SEED'].filter((key) => env[key] === 'true');
}

/** What is about to go, and what is about to stay — counted, never listed by name. */
async function survey() {
  const agentWhere = { role: ROLES.AGENT };
  const [goes, stays] = await Promise.all([
    Promise.all([
      ['نمایندگی (حساب)', prisma.user.count({ where: agentWhere })],
      ['آگهی (هر سه بازار)', prisma.listing.count()],
      ['عکس آگهی', prisma.carPhoto.count()],
      ['نمایش مشخصات', prisma.contactReveal.count()],
      ['گزارش تخلف', prisma.violationReport.count()],
      ['تیکت', prisma.ticket.count()],
      ['پیام تیکت', prisma.ticketMessage.count()],
      ['پیوست تیکت', prisma.ticketAttachment.count()],
      ['درخواست ظرفیت', prisma.seatOrder.count()],
      ['اشتراک', prisma.subscription.count()],
      ['نشست نمایندگی‌ها', prisma.authSession.count({ where: { user: agentWhere } })],
      ['کد یک‌بارمصرف', prisma.otpChallenge.count()],
      ['پیامک', prisma.smsMessage.count()],
      ['لاگ فعالیت', prisma.activityLog.count()],
      ['فهرست قیمت نمایندگی‌ها', prisma.carPriceWatch.count({ where: { owner: agentWhere } })],
    ].map(async ([label, p]) => [label, await p])),
    Promise.all([
      ['حساب مدیریتی (مالک، مدیر، پشتیبانی، مالی)', prisma.user.count({ where: { role: { not: ROLES.AGENT } } })],
      ['پلن', prisma.plan.count()],
      ['تنظیمات', prisma.setting.count()],
      ['شرکت خودروساز', prisma.carCompany.count()],
      ['برند', prisma.carBrand.count()],
      ['مدل', prisma.carModel.count()],
      ['رنگ', prisma.carColor.count()],
      ['قیمت روز (ردیف)', prisma.carPriceItem.count()],
      ['تاریخچه‌ی قیمت', prisma.carPriceHistory.count()],
      ['لاگ خطا', prisma.errorLog.count()],
      ['رویداد امنیتی', prisma.securityEvent.count()],
      ['آی‌پی بسته‌شده', prisma.blockedIp.count()],
    ].map(async ([label, p]) => [label, await p])),
  ]);
  return { goes, stays };
}

/**
 * The wipe itself, in one transaction so a failure half-way leaves the
 * database exactly as it was. Every table is deleted explicitly rather than
 * left to `onDelete: Cascade`: the cascades would do most of it, but a wipe
 * that names what it removes is one a reader can check against the schema.
 */
async function wipeDatabase() {
  const agentWhere = { role: ROLES.AGENT };
  const deleted = {};
  await prisma.$transaction(async (tx) => {
    const step = async (label, promise) => {
      const { count } = await promise;
      deleted[label] = count;
    };
    // Children before parents, so nothing ever refuses on a foreign key.
    await step('contactReveal', tx.contactReveal.deleteMany());
    await step('violationReport', tx.violationReport.deleteMany());
    await step('carPhoto', tx.carPhoto.deleteMany());
    await step('carDetail', tx.carDetail.deleteMany());
    await step('registrationDetail', tx.registrationDetail.deleteMany());
    await step('listing', tx.listing.deleteMany());
    await step('ticketAttachment', tx.ticketAttachment.deleteMany());
    await step('ticketMessage', tx.ticketMessage.deleteMany());
    await step('ticket', tx.ticket.deleteMany());
    await step('seatOrder', tx.seatOrder.deleteMany());
    await step('subscription', tx.subscription.deleteMany());
    await step('otpChallenge', tx.otpChallenge.deleteMany());
    await step('smsMessage', tx.smsMessage.deleteMany());
    await step('activityLog', tx.activityLog.deleteMany());
    await step('carPriceWatch', tx.carPriceWatch.deleteMany({ where: { owner: agentWhere } }));
    await step('authSession', tx.authSession.deleteMany({ where: { user: agentWhere } }));
    await step('brandAccess', tx.brandAccess.deleteMany({ where: { user: agentWhere } }));
    await step('modelAccess', tx.modelAccess.deleteMany({ where: { user: agentWhere } }));
    // Sub-agencies point at their parent with SetNull; deleting all agencies
    // in one statement never trips over that either way.
    await step('user', tx.user.deleteMany({ where: agentWhere }));

    for (const table of SERIAL_TABLES) {
      // Postgres names the sequence (the Listing table kept its «Havale»
      // sequence from before the rename), and setval with is_called=false is
      // the same as RESTART WITH 1 — but takes the name as a bound value, so
      // no identifier is ever spliced into SQL text.
      const [{ seq }] = await tx.$queryRaw`SELECT pg_get_serial_sequence(${`"${table}"`}, 'serial') AS seq`;
      if (seq) await tx.$queryRaw`SELECT setval(${seq}::regclass, 1, false)`;
    }
  });
  return deleted;
}

/** Empties the upload folders. Runs after the commit: files are the one thing a rollback could not bring back. */
function wipeUploads(root) {
  const removed = {};
  for (const subdir of UPLOAD_SUBDIRS) {
    const dir = path.join(root, subdir);
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      removed[subdir] = 0;
      continue;
    }
    let count = 0;
    for (const name of names) {
      const file = path.join(dir, name);
      try {
        if (fs.statSync(file).isFile()) {
          fs.unlinkSync(file);
          count += 1;
        }
      } catch (err) {
        console.error(`  ! ${file}: ${err.message}`);
      }
    }
    removed[subdir] = count;
  }
  return removed;
}

function printSurvey({ goes, stays }) {
  console.log('\nپاک می‌شود:');
  for (const [label, count] of goes) console.log(`  ${String(count).padStart(6)}  ${label}`);
  console.log('\nمی‌ماند:');
  for (const [label, count] of stays) console.log(`  ${String(count).padStart(6)}  ${label}`);
  console.log('');
}

/**
 * @param {object} opts
 * @param {boolean} opts.apply        false = only report
 * @param {string}  opts.uploadsRoot  where the upload folders live
 * @param {object}  opts.env          the environment to check the demo switches in
 * @returns {Promise<{ok: boolean, reason?: string, survey: object, deleted?: object, files?: object}>}
 */
async function resetForLaunch({ apply = false, uploadsRoot, env = process.env } = {}) {
  const root = uploadsRoot || env.UPLOADS_DIR || path.join(process.cwd(), 'uploads');
  const before = await survey();

  const staff = before.stays[0][1];
  if (staff === 0) {
    return { ok: false, reason: 'هیچ حساب مدیریتی وجود ندارد — بعد از پاک‌سازی کسی نمی‌تواند وارد شود. اول `npm run seed`.', survey: before };
  }
  const on = demoSwitchesOn(env);
  if (on.length) {
    return {
      ok: false,
      reason:
        `${on.join(' و ')} هنوز true است — با اولین ری‌استارت، حساب‌های نمونه دوباره ساخته می‌شوند. ` +
        'اول در .env هر دو را false کنید و `docker compose up -d` بزنید، بعد این اسکریپت را.',
      survey: before,
    };
  }
  if (!apply) return { ok: true, survey: before };

  const deleted = await wipeDatabase();
  const files = wipeUploads(root);
  return { ok: true, survey: before, deleted, files };
}

async function main() {
  const apply = process.argv.includes('--apply');
  await connectDatabase();
  try {
    const result = await resetForLaunch({ apply });
    printSurvey(result.survey);
    if (!result.ok) {
      console.error(`✗ انجام نشد: ${result.reason}\n`);
      process.exitCode = 1;
      return;
    }
    if (!apply) {
      console.log('این فقط پیش‌نمایش بود. هیچ‌چیز پاک نشد.');
      console.log('اول بکاپ بگیرید (./deploy/backup.sh daily)، بعد برای اجرای واقعی:');
      console.log('  docker compose exec -T api node scripts/reset-for-launch.js --apply\n');
      return;
    }
    const files = Object.entries(result.files)
      .map(([dir, n]) => `${dir}: ${n}`)
      .join('، ');
    console.log(`✓ پاک شد. فایل‌های حذف‌شده — ${files}`);
    console.log('شماره‌ی تیکت، گزارش، درخواست و آگهی از ۱ شروع می‌شود.');
    console.log('حالا: ./deploy/preflight.sh — و بعد اولین نمایندگی را از پنل بسازید.\n');
  } finally {
    await disconnectDatabase().catch(() => {});
  }
}

if (require.main === module) {
  main().catch(async (err) => {
    console.error(`✗ خطا: ${err.message}`);
    await disconnectDatabase().catch(() => {});
    process.exit(1);
  });
}

module.exports = { resetForLaunch, wipeUploads, demoSwitchesOn, UPLOAD_SUBDIRS };
