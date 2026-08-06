/* eslint-disable no-console */
//
// Console rather than the logger, on purpose: this is an interactive prompt,
// and its output is the interface. Structured JSON lines would be the wrong
// thing to put in front of somebody typing a password.
require('dotenv').config();

const readline = require('readline');
const { Writable } = require('stream');
const bcrypt = require('bcryptjs');

const config = require('../src/config');
const { prisma, connectDatabase, disconnectDatabase } = require('../src/config/database');
const { ROLES } = require('../src/constants/roles');

/**
 * Creates the owner account.
 *
 * This exists as a script on the server rather than a screen in the panel, and
 * that is the whole point: the account nobody can see is also the account
 * nobody can create. Making it requires a shell on the machine, which is the
 * real trust boundary — administrators have the panel, not SSH.
 *
 *   docker compose exec -T api npm run create:owner
 *
 * The username and password are typed here and never printed, never passed as
 * arguments (which would put them in shell history and in `ps`), and never
 * written to a log. Choose a username nobody would try: usernames are unique,
 * so somebody creating an agency with the same one would be told it is taken,
 * and that is the one leak this design cannot close. `owner`, `admin`, and
 * your own name are all guesses somebody makes eventually.
 */

/**
 * Asking a question, in a way that survives both a terminal and a pipe.
 *
 * Two paths, because one does not cover both:
 *
 *   A terminal — the real case. readline, with the echo muted while a password
 *   is being typed. A password on screen is a password in a screenshot, in a
 *   screen share, and over the shoulder of whoever is standing behind you.
 *
 *   A pipe — how this gets tested. Here readline is the wrong tool entirely: it
 *   reads until end of input and then closes, and since the first thing this
 *   script does is await a database connection, it has closed before the first
 *   question is ever asked. So piped input is read once, up front, and handed
 *   out a line at a time.
 */
const isTty = process.stdin.isTTY === true;

let piped = null;
function readPiped() {
  if (piped) return piped;
  let data = '';
  try {
    data = require('fs').readFileSync(0, 'utf8');
  } catch {
    data = '';
  }
  piped = data.split('\n');
  return piped;
}

const output = new Writable({
  write(chunk, encoding, callback) {
    if (!output.muted) process.stdout.write(chunk, encoding);
    callback();
  },
});
output.muted = false;

let rl = null;
function terminal() {
  if (!rl) {
    rl = readline.createInterface({ input: process.stdin, output, terminal: true });
  }
  return rl;
}

function ask(question, { hidden = false } = {}) {
  // The prompt is always visible; only what is typed back can be hidden.
  process.stdout.write(question);

  if (!isTty) {
    const line = readPiped().shift() ?? '';
    process.stdout.write('\n');
    return Promise.resolve(line.trim());
  }

  return new Promise((resolve) => {
    output.muted = hidden;
    terminal().question('', (answer) => {
      output.muted = false;
      if (hidden) process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

async function main() {
  await connectDatabase();

  const existing = await prisma.user.findFirst({ where: { role: ROLES.OWNER } });
  if (existing && !process.argv.includes('--force')) {
    // Says one already exists without saying which, because the point of the
    // account is that its name is not lying around.
    console.error('یک حساب مالک از قبل وجود دارد.');
    console.error('اگر واقعاً می‌خواهید یکی دیگر بسازید:  npm run create:owner -- --force');
    process.exitCode = 1;
    return;
  }

  console.log('\n▌ ساخت حساب مالک');
  console.log('  این حساب برای هیچ نقش دیگری قابل دیدن نیست.');
  console.log('  نام کاربری را چیزی بگذارید که کسی حدس نزند — نه owner، نه admin، نه اسم خودتان.\n');

  const username = await ask('  نام کاربری: ');
  if (!/^[a-zA-Z0-9._-]{4,40}$/.test(username)) {
    console.error('\n✗ نام کاربری باید ۴ تا ۴۰ کاراکتر انگلیسی، عدد، نقطه، خط تیره یا زیرخط باشد.');
    process.exitCode = 1;
    return;
  }

  const taken = await prisma.user.findUnique({ where: { username }, select: { id: true } });
  if (taken) {
    console.error('\n✗ این نام کاربری قبلاً استفاده شده است.');
    process.exitCode = 1;
    return;
  }

  const password = await ask('  رمز عبور (نمایش داده نمی‌شود): ', { hidden: true });
  if (password.length < 12) {
    console.error('\n✗ رمز حداقل ۱۲ کاراکتر باشد. این حساب همه‌چیز را می‌بیند.');
    process.exitCode = 1;
    return;
  }
  const again = await ask('  تکرار رمز: ', { hidden: true });
  if (password !== again) {
    console.error('\n✗ دو رمز یکی نیستند.');
    process.exitCode = 1;
    return;
  }

  const fullName = (await ask('  نام و نام خانوادگی: ')) || 'مالک';
  const phone = await ask('  شماره تماس: ');
  if (!/^09\d{9}$/.test(phone)) {
    console.error('\n✗ شماره تماس باید با ۰۹ شروع شود و ۱۱ رقم باشد.');
    process.exitCode = 1;
    return;
  }

  const user = await prisma.user.create({
    data: {
      username,
      passwordHash: await bcrypt.hash(password, config.security.bcryptRounds),
      phone,
      fullName,
      role: ROLES.OWNER,
      status: 'ACTIVE',
      // No forced change: the password was chosen here, by the person who will
      // use it, and was never seen by anybody else.
      mustChangePassword: false,
    },
    select: { id: true, role: true },
  });

  console.log('\n✓ حساب مالک ساخته شد.');
  console.log('  نقش:', user.role);
  console.log('\n  از این پس با همین حساب وارد شوید. حساب admin برای بقیه دست‌نخورده می‌ماند،');
  console.log('  و هیچ‌کدامشان وجود این حساب را نمی‌بینند.\n');
}

main()
  .catch(async (err) => {
    console.error('✗', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (rl) rl.close();
    await disconnectDatabase().catch(() => {});
    process.exit(process.exitCode || 0);
  });
