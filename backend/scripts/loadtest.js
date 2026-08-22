/* eslint-disable no-console */
/**
 * Load test — how the whole stack behaves under real concurrent traffic.
 *
 * Answers one question with numbers rather than opinion: at N users hitting
 * the panel at once, does anything break, and how long does a page take?
 *
 * ── What it exercises ───────────────────────────────────────────────────────
 *
 * Pointed at nginx (the default inside the compose network), every request
 * travels the same path a real one does: nginx → API → Prisma pool → Postgres.
 * The mix is what a working panel actually does — the search list is the
 * heaviest query in the product, so it carries the most weight.
 *
 * ── What it deliberately does not do ────────────────────────────────────────
 *
 * Read-only by default. It never reveals a contact (that spends the agency's
 * real daily allowance and writes a permanent row) and never posts a listing
 * unless asked with --write, which cleans up after itself.
 *
 * ── Two things about this system that shape the test ────────────────────────
 *
 *   One live session per account. Signing in twice ends the first session, so
 *   every virtual user shares one cookie per account. Pass several accounts to
 *   spread the load over several sessions.
 *
 *   The rate limiter keys on the session cookie: 1200 requests per fifteen
 *   minutes. Past that it answers 429 — which is the protection working, not a
 *   failure, and is counted and reported separately so it cannot be mistaken
 *   for one.
 *
 * Usage (inside the api container, through nginx):
 *   node scripts/loadtest.js --target http://web --users 50 --requests 1000 \
 *        --account username:password
 *
 * Or, better on a server somebody else can run `ps` on: pass
 * `--accounts-stdin` and feed «username:password» lines on standard input, so
 * no password ever appears in an argument list or a shell history. That is
 * what deploy/loadtest.sh does.
 */

const TARGET = argValue('--target', 'http://web');
const USERS = Number(argValue('--users', '50'));
const REQUESTS = Number(argValue('--requests', '1000'));
const WRITES = Number(argValue('--write', '0'));
const ACCOUNTS = argAll('--account');
const ACCOUNTS_FROM_STDIN = process.argv.includes('--accounts-stdin');

function argValue(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function argAll(name) {
  const out = [];
  process.argv.forEach((a, i) => {
    if (a === name && process.argv[i + 1]) out.push(process.argv[i + 1]);
  });
  return out;
}

const API = `${TARGET.replace(/\/$/, '')}/api/v1`;

/**
 * The mix, weighted by how often a working panel makes each call.
 *
 * `weight` is relative, not a percentage — the numbers only matter next to
 * each other, so adding a route later does not mean rebalancing the rest.
 */
const ROUTES = [
  { name: 'استعلام حواله‌ها', path: '/havales?limit=20', weight: 35 },
  { name: 'حواله‌های من', path: '/havales/mine?limit=20', weight: 15 },
  { name: 'کاتالوگ', path: '/catalog', weight: 15 },
  { name: 'سقف نمایش', path: '/havales/reveal-usage', weight: 10 },
  { name: 'اشتراک من', path: '/subscriptions/me', weight: 10 },
  { name: 'پشتیبانی', path: '/tickets', weight: 10 },
  { name: 'سلامت', path: '/health', weight: 5 },
];

const PICKER = ROUTES.flatMap((r) => Array(r.weight).fill(r));

const stats = new Map();
function record(name, ms, status) {
  let s = stats.get(name);
  if (!s) {
    s = { times: [], ok: 0, rateLimited: 0, failed: 0, statuses: new Map() };
    stats.set(name, s);
  }
  s.times.push(ms);
  s.statuses.set(status, (s.statuses.get(status) || 0) + 1);
  if (status === 429) s.rateLimited += 1;
  else if (status >= 200 && status < 400) s.ok += 1;
  else s.failed += 1;
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[i];
}

async function signIn(spec) {
  const [username, ...rest] = spec.split(':');
  const password = rest.join(':');
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    throw new Error(`ورود «${username}» ناموفق بود (${res.status}) — نام کاربری یا رمز را بررسی کنید.`);
  }
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  if (!cookie) throw new Error('پاسخ ورود کوکی نداشت.');
  return { username, cookie };
}

async function hit(session, route) {
  const started = process.hrtime.bigint();
  let status = 0;
  try {
    const res = await fetch(API + route.path, { headers: { Cookie: session.cookie } });
    status = res.status;
    // Draining the body is part of the request: measuring only the headers
    // would report a speed nobody experiences.
    await res.arrayBuffer();
  } catch {
    status = 0; // connection refused, reset, timeout
  }
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  record(route.name, ms, status);
  return status;
}

/** A purchase request: the write path, without the brand-access rules. */
async function writeOnce(session, catalogue) {
  const model = catalogue[Math.floor(Math.random() * catalogue.length)];
  const started = process.hrtime.bigint();
  let status = 0;
  let id = null;
  try {
    const res = await fetch(`${API}/havales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: session.cookie },
      body: JSON.stringify({
        kind: 'REQUEST',
        carModelId: model,
        solh: 'SOLH',
        description: 'تست بار — این آگهی خودکار حذف می‌شود',
      }),
    });
    status = res.status;
    const body = await res.json().catch(() => null);
    id = body?.data?.id || null;
  } catch {
    status = 0;
  }
  record('ثبت درخواست (نوشتن)', Number(process.hrtime.bigint() - started) / 1e6, status);
  return id;
}

/** «username:password» lines, one per account, read to the end. */
async function readAccountsFromStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks)
    .toString('utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && line.includes(':'));
}

async function main() {
  if (ACCOUNTS_FROM_STDIN) ACCOUNTS.push(...(await readAccountsFromStdin()));

  if (!ACCOUNTS.length) {
    console.error('یک حساب نماینده لازم است:  --account نام‌کاربری:رمز');
    console.error('برای پخش بار روی چند نشست، چند بار --account بدهید.');
    process.exit(1);
  }

  console.log(`هدف: ${TARGET}`);
  console.log(`کاربر هم‌زمان: ${USERS} · مجموع درخواست: ${REQUESTS}${WRITES ? ` · نوشتن: ${WRITES}` : ''}`);
  console.log('ورود…');

  const sessions = [];
  for (const spec of ACCOUNTS) sessions.push(await signIn(spec));
  console.log(`${sessions.length} نشست آماده شد.\n`);

  // A warm-up that is not measured: the first request pays for the connection
  // pool waking up and Prisma's first query plan, and reporting that as the
  // system's speed would be reporting a number nobody ever experiences twice.
  await Promise.all(sessions.map((s) => hit(s, ROUTES[0])));
  stats.clear();

  let catalogue = [];
  if (WRITES > 0) {
    const res = await fetch(`${API}/catalog`, { headers: { Cookie: sessions[0].cookie } });
    const tree = await res.json();
    const brand = (tree.data?.brands || [])[0];
    if (brand) {
      const models = await fetch(`${API}/catalog/brands/${brand.id}/models`, {
        headers: { Cookie: sessions[0].cookie },
      }).then((r) => r.json());
      catalogue = (models.data?.models || []).map((m) => m.id);
    }
    if (!catalogue.length) {
      console.log('⚠ مدلی برای تست نوشتن پیدا نشد — فقط خواندن تست می‌شود.\n');
    }
  }

  const written = [];
  let issued = 0;
  let writesLeft = catalogue.length ? WRITES : 0;
  const startedAt = Date.now();

  async function worker(index) {
    const session = sessions[index % sessions.length];
    for (;;) {
      if (writesLeft > 0) {
        writesLeft -= 1;
        const id = await writeOnce(session, catalogue);
        if (id) written.push({ id, cookie: session.cookie });
        continue;
      }
      if (issued >= REQUESTS) return;
      issued += 1;
      await hit(session, PICKER[Math.floor(Math.random() * PICKER.length)]);
    }
  }

  await Promise.all(Array.from({ length: USERS }, (_, i) => worker(i)));
  const elapsed = (Date.now() - startedAt) / 1000;

  // Whatever the test created, the test removes.
  for (const w of written) {
    await fetch(`${API}/havales/${w.id}`, {
      method: 'DELETE',
      headers: { Cookie: w.cookie },
    }).catch(() => {});
  }
  if (written.length) console.log(`${written.length} آگهی آزمایشی پاک شد.\n`);

  report(elapsed);
}

function report(elapsed) {
  const all = [];
  let ok = 0;
  let limited = 0;
  let failed = 0;

  console.log('─'.repeat(74));
  console.log(
    'مسیر'.padEnd(22) +
      'تعداد'.padStart(7) +
      'میانه'.padStart(9) +
      'p95'.padStart(9) +
      'p99'.padStart(9) +
      'کندترین'.padStart(10) +
      'خطا'.padStart(8)
  );
  console.log('─'.repeat(74));

  for (const [name, s] of stats) {
    const sorted = [...s.times].sort((a, b) => a - b);
    all.push(...sorted);
    ok += s.ok;
    limited += s.rateLimited;
    failed += s.failed;
    console.log(
      name.padEnd(22) +
        String(s.times.length).padStart(7) +
        `${percentile(sorted, 50).toFixed(0)}ms`.padStart(9) +
        `${percentile(sorted, 95).toFixed(0)}ms`.padStart(9) +
        `${percentile(sorted, 99).toFixed(0)}ms`.padStart(9) +
        `${sorted[sorted.length - 1].toFixed(0)}ms`.padStart(10) +
        String(s.failed).padStart(8)
    );
  }

  const sorted = all.sort((a, b) => a - b);
  const total = sorted.length;
  console.log('─'.repeat(74));
  console.log(`\nمدت آزمون: ${elapsed.toFixed(1)} ثانیه · ${(total / elapsed).toFixed(0)} درخواست بر ثانیه`);
  console.log(`موفق: ${ok} · محدودشده (۴۲۹): ${limited} · ناموفق: ${failed}`);
  console.log(
    `تأخیر کلی — میانه ${percentile(sorted, 50).toFixed(0)}ms · ` +
      `p95 ${percentile(sorted, 95).toFixed(0)}ms · p99 ${percentile(sorted, 99).toFixed(0)}ms`
  );

  console.log('\nنتیجه:');
  const p95 = percentile(sorted, 95);
  if (failed > 0) {
    console.log(`  ✗ ${failed} درخواست ناموفق بود — خروجی بالا می‌گوید کدام مسیر.`);
  } else {
    console.log('  ✓ هیچ درخواستی با خطا برنگشت.');
  }
  if (limited > 0) {
    console.log(
      `  ! ${limited} درخواست با ۴۲۹ محدود شد — این یعنی محافظ نرخ کار می‌کند، نه اینکه سرور کم آورده.`
    );
    console.log('    برای آزمون سنگین‌تر، چند حساب بدهید تا بار روی چند نشست پخش شود.');
  }
  if (p95 < 400) console.log(`  ✓ p95 برابر ${p95.toFixed(0)}ms — برای پنل کاملاً روان است.`);
  else if (p95 < 1000) console.log(`  ! p95 برابر ${p95.toFixed(0)}ms — قابل قبول ولی جای بهبود دارد.`);
  else console.log(`  ✗ p95 برابر ${p95.toFixed(0)}ms — کاربر کندی را حس می‌کند.`);

  console.log('\nمصرف منابع را جداگانه ببینید:  docker stats --no-stream');
}

main().catch((err) => {
  console.error(`\n✗ ${err.message}`);
  process.exit(1);
});
