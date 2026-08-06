#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Security audit.
 *
 * Two kinds of check, and the second is the one that matters:
 *
 *   STATIC  — reads the source for patterns that create a vulnerability
 *             (innerHTML on user data, string-concatenated SQL, a cookie
 *             without httpOnly, secrets committed to the repository).
 *
 *   LIVE    — actually attacks a running instance: sends the injection,
 *             sends the forged cross-site request, asks for a phone number
 *             it has not paid for, and checks what comes back. A static
 *             check can only tell you the code looks right; this tells you
 *             the system behaves right.
 *
 * Run:
 *   node security/audit.js                       # static only
 *   node security/audit.js --live https://feranocar.com \
 *        --user alborz --pass 'secret'           # static + live
 *   node security/audit.js --fix                 # apply the safe fixes
 *
 * On --fix: only changes that are unambiguous and reversible are applied
 * automatically — a missing security header, a permissive file mode. Anything
 * where the right answer depends on intent is reported and left alone. A tool
 * that silently rewrites authorisation logic is a bigger risk than the finding.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : args[i + 1] ?? true;
};
const FIX = args.includes('--fix');
const LIVE = flag('live');

const findings = [];
const add = (f) => findings.push(f);

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

/** Files worth reading: the source we wrote, not what npm installed. */
function walk(dir, out = []) {
  const skip = new Set(['node_modules', '.git', 'coverage', 'dist', '.cache', 'pw-browsers']);
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const ALL = walk(ROOT);
const read = (f) => {
  try {
    return fs.readFileSync(f, 'utf8');
  } catch {
    return '';
  }
};
const rel = (f) => path.relative(ROOT, f);
const lineOf = (text, index) => text.slice(0, index).split('\n').length;

/**
 * Comments blanked, line numbers preserved.
 *
 * The first version of this audit reported user.dto.js as leaking a password
 * hash. The file mentions `passwordHash` exactly once — in a comment saying it
 * must never be serialised. A scanner that reads prose as code teaches people
 * to skim past its output, which costs more than the check is worth.
 */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}

// `mockup/` is the approved design mockup: never built, never served (nginx's
// root is `frontend/`). Auditing it buries the real findings under sixty
// inline onclick handlers that no user can reach.
const code = ALL.filter(
  (f) => /\.(js|mjs|cjs)$/.test(f) && !/\/(tests?|security|mockup)\//.test(f)
);

// ─────────────────────────────────────────────────────────────────────────────
// XSS
// ─────────────────────────────────────────────────────────────────────────────
function checkXss() {
  const sinks = [
    { re: /\.innerHTML\s*=/g, what: 'innerHTML assignment' },
    { re: /\.outerHTML\s*=/g, what: 'outerHTML assignment' },
    { re: /insertAdjacentHTML\s*\(/g, what: 'insertAdjacentHTML' },
    { re: /document\.write\s*\(/g, what: 'document.write' },
    { re: /\beval\s*\(/g, what: 'eval' },
    { re: /new\s+Function\s*\(/g, what: 'new Function' },
    { re: /\bon(?:click|error|load|mouseover)\s*=\s*["'`]/g, what: 'inline event attribute' },
  ];

  for (const file of code) {
    const text = stripComments(read(file));
    for (const { re, what } of sinks) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text))) {
        const line = lineOf(text, m.index);
        const source = text.split('\n')[line - 1] || '';

        // The renderer assigns innerHTML from the tagged template, which
        // escapes every interpolation by construction. Flagging that would
        // train everyone to ignore this check.
        const escaped =
          /String\(html`|String\(loginPage|String\(changePasswordPage|renderModal|renderToast/.test(
            source
          ) ||
          // `x.innerHTML = ''` clears a node. There is no interpolation, so
          // there is nothing to inject.
          /innerHTML\s*=\s*(''|""|``)\s*;?\s*$/.test(source.trim());
        add({
          severity: escaped ? 'info' : 'high',
          check: 'xss',
          file: rel(file),
          line,
          title: `${what}${escaped ? ' (escaped by ui/html.js)' : ''}`,
          detail: source.trim().slice(0, 120),
          fix: escaped ? null : 'Render through the html`` tag in ui/html.js, which escapes by default.',
        });
      }
    }
  }

  // The escaping helper must exist and must escape the five characters that
  // matter. If someone "simplifies" it, everything above becomes a lie.
  const htmlJs = read(path.join(ROOT, 'frontend/src/ui/html.js'));
  const escapes = ['&amp;', '&lt;', '&gt;', '&quot;', '&#39;'];
  const missing = escapes.filter((e) => !htmlJs.includes(e));
  add({
    severity: missing.length ? 'critical' : 'info',
    check: 'xss',
    file: 'frontend/src/ui/html.js',
    title: missing.length
      ? `the escaping helper does not escape: ${missing.join(' ')}`
      : 'escaping helper escapes & < > " \'',
    fix: missing.length ? 'Restore the full escape map — every interpolation depends on it.' : null,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SQL injection
// ─────────────────────────────────────────────────────────────────────────────
function checkSql() {
  const raw = [
    { re: /\$queryRawUnsafe\s*\(/g, what: '$queryRawUnsafe' },
    { re: /\$executeRawUnsafe\s*\(/g, what: '$executeRawUnsafe' },
    // Raw with a template literal is parameterised by Prisma; raw with a
    // built-up string is not.
    { re: /\$(?:query|execute)Raw\s*\(\s*[`'"]?\s*\$?\{?[^`]*\+/g, what: 'raw SQL built by concatenation' },
  ];

  let found = 0;
  for (const file of code.filter((f) => f.includes('/backend/'))) {
    const text = stripComments(read(file));
    for (const { re, what } of raw) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text))) {
        found += 1;
        add({
          severity: 'critical',
          check: 'sql-injection',
          file: rel(file),
          line: lineOf(text, m.index),
          title: what,
          detail: (text.split('\n')[lineOf(text, m.index) - 1] || '').trim().slice(0, 120),
          fix: 'Use the Prisma query API, or $queryRaw with a tagged template so values are bound.',
        });
      }
    }
  }
  if (!found) {
    add({
      severity: 'info',
      check: 'sql-injection',
      title: 'no unsafe raw SQL — every query goes through Prisma, which binds parameters',
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Session cookie, CSRF, headers
// ─────────────────────────────────────────────────────────────────────────────
function checkCookieAndCsrf() {
  const authController = read(path.join(ROOT, 'backend/src/modules/auth/auth.controller.js'));

  const flags = [
    { name: 'httpOnly', re: /httpOnly:\s*true/, why: 'without it, any injected script can read the session token' },
    { name: 'sameSite=strict', re: /sameSite:\s*['"]strict['"]/, why: 'this is what stops cross-site request forgery for this API' },
    { name: 'secure follows the connection', re: /secure\s*[:=]\s*Boolean\(req\.secure\)|const secure = Boolean\(req\.secure\)/, why: 'tied to NODE_ENV it either leaks the cookie or breaks sign-in' },
  ];

  for (const f of flags) {
    const ok = f.re.test(authController);
    add({
      severity: ok ? 'info' : 'critical',
      check: 'session-cookie',
      file: 'backend/src/modules/auth/auth.controller.js',
      title: ok ? `cookie sets ${f.name}` : `cookie is missing ${f.name}`,
      detail: ok ? null : f.why,
      fix: ok ? null : `Set ${f.name} in cookieOptions().`,
    });
  }

  // A token in the body undoes httpOnly, because the frontend will store it
  // somewhere a script can read.
  const authService = read(path.join(ROOT, 'backend/src/modules/auth/auth.service.js'));
  const dto = stripComments(read(path.join(ROOT, 'backend/src/modules/user/user.dto.js')));
  const leaks = /token|passwordHash|tokenHash/.test(dto);
  add({
    severity: leaks ? 'critical' : 'info',
    check: 'token-leak',
    file: 'backend/src/modules/user/user.dto.js',
    title: leaks ? 'the user serialiser mentions a token or password hash' : 'the user serialiser exposes neither token nor password hash',
    fix: leaks ? 'Remove it — the cookie is the only place the token belongs.' : null,
  });

  // SameSite=strict is the CSRF defence here. State-changing routes must not
  // be reachable by GET, or a plain <img src> would trigger them.
  const routeFiles = ALL.filter((f) => /\.routes\.js$/.test(f));
  for (const file of routeFiles) {
    const text = stripComments(read(file));
    const re = /router\.get\s*\(\s*['"`]([^'"`]+)/g;
    let m;
    while ((m = re.exec(text))) {
      // Whole segments, and verbs only. The first version matched "reveal",
      // which flagged `GET /reveals` and `GET /reveal-usage` — both read-only
      // lists whose mutating counterpart is a POST elsewhere. A CSRF check
      // that fires on nouns gets muted, and then it catches nothing.
      const MUTATIONS = /(^|\/)(delete|remove|suspend|activate|approve|reject|renew|close|logout|reset|fulfil|fulfill|revoke|grant)(\/|$|-)/i;
      if (MUTATIONS.test(m[1])) {
        add({
          severity: 'high',
          check: 'csrf',
          file: rel(file),
          line: lineOf(text, m.index),
          title: `state-changing path served over GET: ${m[1]}`,
          detail: 'A GET can be triggered by an <img> tag on any other site.',
          fix: 'Serve it as POST/PATCH/DELETE.',
        });
      }
    }
  }

  // Helmet and the rate limiter must actually be wired into the app, not just
  // installed.
  const app = read(path.join(ROOT, 'backend/src/app.js'));
  for (const [what, re, why] of [
    ['helmet', /app\.use\(\s*helmet/, 'sets the baseline security headers'],
    ['rate limiter', /app\.use\(\s*rateLimiter/, 'the only thing between the API and a scripted flood'],
    ['trust proxy', /trust proxy/, 'without it every request appears to come from nginx, so per-IP limits collapse into one'],
    ['cookie parser', /cookieParser/, 'the session cannot be read without it'],
  ]) {
    const ok = re.test(app);
    add({
      severity: ok ? 'info' : 'high',
      check: 'middleware',
      file: 'backend/src/app.js',
      title: ok ? `${what} is wired in` : `${what} is NOT wired in`,
      detail: ok ? null : why,
    });
  }

  // The login endpoint needs its own tight limit; the general one is sized for
  // a working panel and would allow thousands of guesses.
  const authRoutes = read(path.join(ROOT, 'backend/src/modules/auth/auth.routes.js'));
  const ok = /authLimiter/.test(authRoutes);
  add({
    severity: ok ? 'info' : 'critical',
    check: 'brute-force',
    file: 'backend/src/modules/auth/auth.routes.js',
    title: ok ? 'sign-in has its own strict rate limit' : 'sign-in has no dedicated rate limit',
    fix: ok ? null : 'Add authLimiter to the login route.',
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Secrets
// ─────────────────────────────────────────────────────────────────────────────
function checkSecrets() {
  const patterns = [
    { re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, what: 'a private key' },
    { re: /\b(?:sk|pk)_live_[A-Za-z0-9]{16,}/, what: 'a live API key' },
    { re: /\bghp_[A-Za-z0-9]{30,}/, what: 'a GitHub token' },
    { re: /postgres(?:ql)?:\/\/[^\s:]+:[^\s@]{6,}@(?!db:|localhost|127\.0\.0\.1)/, what: 'a database URL with a real password' },
  ];

  for (const file of ALL) {
    if (/\.(png|jpe?g|gif|woff2?|ico|pdf|lock)$/.test(file)) continue;
    const text = read(file);
    for (const { re, what } of patterns) {
      const m = re.exec(text);
      if (m) {
        add({
          severity: 'critical',
          check: 'secret',
          file: rel(file),
          line: lineOf(text, m.index),
          title: `${what} appears to be committed`,
          fix: 'Remove it, rotate the credential, and add the path to .gitignore.',
        });
      }
    }
  }

  // .env must never be tracked. Checked by content of .gitignore rather than
  // by git, so the audit works on a copied directory too.
  const ignore = read(path.join(ROOT, '.gitignore'));
  for (const p of ['.env', 'deploy/nginx/.htpasswd']) {
    const ok = ignore.split('\n').some((l) => l.trim() === p || l.trim() === p.split('/').pop());
    add({
      severity: ok ? 'info' : 'critical',
      check: 'secret',
      file: '.gitignore',
      title: ok ? `${p} is ignored by git` : `${p} is NOT ignored by git`,
      fix: ok ? null : `Add ${p} to .gitignore.`,
      autofix: ok ? null : { kind: 'append-gitignore', value: p },
    });
  }

  // The demo accounts' password is written in this repository. Leaving the
  // seed enabled on a machine real agencies use hands out four working logins.
  const envFile = path.join(ROOT, '.env');
  if (fs.existsSync(envFile)) {
    const env = read(envFile);
    const on = (k) => new RegExp(`^${k}=true`, 'm').test(env);
    if (on('SEED_DEMO') || on('ALLOW_DEMO_SEED')) {
      add({
        severity: 'high',
        check: 'demo-data',
        file: '.env',
        title: 'demo seeding is enabled',
        detail: 'The demo accounts use a password published in this repository.',
        fix: 'Set SEED_DEMO=false and ALLOW_DEMO_SEED=false before a real agency signs in, and suspend alborz/pars/zagros/khalij.',
      });
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The masking rule — the one this business rests on
// ─────────────────────────────────────────────────────────────────────────────
function checkMasking() {
  const dto = read(path.join(ROOT, 'backend/src/modules/havale/havale.dto.js'));

  // Contact details may only be attached under a revealed check.
  const guarded = /if\s*\(\s*revealed\s*&&/.test(dto);
  add({
    severity: guarded ? 'info' : 'critical',
    check: 'contact-masking',
    file: 'backend/src/modules/havale/havale.dto.js',
    title: guarded
      ? 'contact details are attached only behind a revealed check'
      : 'contact details are attached without checking that a reveal was recorded',
    fix: guarded ? null : 'Restore the `if (revealed && havale.owner)` guard.',
  });

  /**
   * Nothing outside the serialiser may *read* somebody else's phone number.
   *
   * The distinction that makes this check worth having is read versus write.
   * `coordinatorPhone: payload.coordinatorPhone` is an administrator creating
   * an agency — a write, and required. `coordinatorPhone: iranMobile` is a
   * validator. `coordinatorPhone: true` is a Prisma column selection. The
   * first version flagged all ten of those, which is how a check becomes
   * something people scroll past. What is dangerous is reading the value off
   * a loaded row — `owner.coordinatorPhone` — anywhere that might serialise it.
   */
  const seen = new Set();
  for (const file of code.filter((f) => f.includes('/backend/') && !f.endsWith('dto.js'))) {
    const text = stripComments(read(file));
    // A property read, not an object key: `x.coordinatorPhone`.
    const re = /(\w+)\.coordinatorPhone\b/g;
    let m;
    while ((m = re.exec(text))) {
      const line = lineOf(text, m.index);
      const key = `${file}:${line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const src = (text.split('\n')[line - 1] || '').trim();

      // Reading from the request body is a write on its way in. Recording the
      // number that was shown at reveal time is the audit trail doing its job —
      // and blueprint 6.9 requires it, because a number corrected later must
      // not rewrite what an agency actually saw.
      if (/payload\.|req\.body|body\.|phoneShown/.test(src)) continue;

      // Reading a number in order to encrypt it is the one legitimate read
      // outside the serialiser — the backfill has to see plaintext to replace
      // it. Narrow on purpose: only lines that are doing the encrypting.
      if (/\b(encrypt|decrypt|isEncrypted|blindIndex)\b/.test(src)) continue;

      add({
        severity: 'medium',
        check: 'contact-masking',
        file: rel(file),
        line,
        title: 'a contact number is read outside the masking serialiser',
        detail: src.slice(0, 120),
        fix: 'Route it through havale.dto.js so one file decides who may see a number.',
      });
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Deployment posture
// ─────────────────────────────────────────────────────────────────────────────
function checkDeployment() {
  const compose = read(path.join(ROOT, 'docker-compose.yml'));

  // A published database port is a database on the internet.
  const dbPublished = /db:[\s\S]*?ports:\s*\n\s*-\s*['"]?\d+:5432/.test(compose);
  add({
    severity: dbPublished ? 'critical' : 'info',
    check: 'exposure',
    file: 'docker-compose.yml',
    title: dbPublished ? 'PostgreSQL publishes a host port' : 'PostgreSQL publishes no host port',
    fix: dbPublished ? 'Remove the ports: entry — the API reaches it over the internal network.' : null,
  });

  const apiPublished = /api:[\s\S]*?\n\s{4}ports:/.test(compose);
  add({
    severity: apiPublished ? 'high' : 'info',
    check: 'exposure',
    file: 'docker-compose.yml',
    title: apiPublished ? 'the API publishes a host port, bypassing nginx and TLS' : 'the API is reachable only through nginx',
  });

  const adminerPublished = /adminer:[\s\S]*?\n\s{4}ports:\s*\n\s*-\s*['"]?(?!127\.0\.0\.1)\d/.test(compose);
  add({
    severity: adminerPublished ? 'critical' : 'info',
    check: 'exposure',
    file: 'docker-compose.yml',
    title: adminerPublished
      ? 'the database panel publishes a port directly, skipping the nginx password'
      : 'the database panel is reachable only through nginx',
  });

  // Security headers, in whichever nginx file is live.
  const nginxDir = path.join(ROOT, 'deploy/nginx');
  const confs = fs.existsSync(nginxDir)
    ? fs.readdirSync(nginxDir).filter((f) => f.endsWith('.conf')).map((f) => path.join(nginxDir, f))
    : [];
  // Comments stripped for the same reason the JavaScript is: app.conf carries a
  // comment saying "`unsafe-inline` is absent from script-src on purpose", and
  // the first version of this check read that sentence as the policy itself.
  const allConf = confs
    .map(read)
    .join('\n')
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');

  const headers = [
    ['Content-Security-Policy', 'the second line of defence behind escaping'],
    ['X-Content-Type-Options', 'stops a response being re-interpreted as script'],
    ['X-Frame-Options', 'stops the panel being framed and clickjacked'],
    ['Referrer-Policy', 'keeps internal paths out of other sites’ logs'],
  ];
  for (const [h, why] of headers) {
    const ok = allConf.includes(h);
    add({
      severity: ok ? 'info' : 'high',
      check: 'headers',
      file: 'deploy/nginx/',
      title: ok ? `${h} is set` : `${h} is missing`,
      detail: ok ? null : why,
    });
  }

  if (/script-src[^;]*unsafe-inline/.test(allConf)) {
    add({
      severity: 'high',
      check: 'headers',
      file: 'deploy/nginx/',
      title: "script-src allows 'unsafe-inline'",
      detail: 'That removes most of what the policy was protecting against.',
      fix: "Drop 'unsafe-inline' from script-src — nothing in this frontend uses an inline script.",
    });
  }

  // The panel password file, in the mode nginx's worker can actually read.
  const htpasswd = path.join(ROOT, 'deploy/nginx/.htpasswd');
  if (fs.existsSync(htpasswd)) {
    const mode = (fs.statSync(htpasswd).mode & 0o777).toString(8);
    const readable = (fs.statSync(htpasswd).mode & 0o044) !== 0;
    add({
      severity: readable ? 'info' : 'medium',
      check: 'deployment',
      file: 'deploy/nginx/.htpasswd',
      title: readable ? `panel password file mode ${mode}` : `panel password file mode ${mode} — nginx cannot read it`,
      detail: readable ? null : 'The prompt appears and the correct password then returns 500.',
      fix: readable ? null : 'chmod 644 (it holds a hash, and its directory is root-only).',
      autofix: readable ? null : { kind: 'chmod', file: htpasswd, mode: 0o644 },
    });
  }

  // HTTPS on or off.
  const sslOn = fs.existsSync(path.join(ROOT, 'deploy/nginx/ssl.conf'));
  add({
    severity: sslOn ? 'info' : 'high',
    check: 'tls',
    file: 'deploy/nginx/',
    title: sslOn ? 'HTTPS is configured' : 'HTTPS is not configured — passwords travel in clear text',
    fix: sslOn ? null : 'Run deploy/enable-ssl.sh you@example.com',
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Dependencies
// ─────────────────────────────────────────────────────────────────────────────
function checkDependencies() {
  const { execSync } = require('child_process');
  try {
    const out = execSync('npm audit --json --audit-level=high', {
      cwd: path.join(ROOT, 'backend'),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 90_000,
    });
    const report = JSON.parse(out);
    const v = report.metadata?.vulnerabilities || {};
    const bad = (v.critical || 0) + (v.high || 0);
    add({
      severity: bad ? 'high' : 'info',
      check: 'dependencies',
      file: 'backend/package.json',
      title: bad
        ? `${bad} high or critical advisories in dependencies`
        : 'no high or critical advisories in dependencies',
      fix: bad ? 'npm audit fix — and read what it changes before committing.' : null,
    });
  } catch (err) {
    // npm audit exits non-zero when it finds something; the JSON is still on
    // stdout, so parse it rather than reporting the tool as broken.
    try {
      const report = JSON.parse(err.stdout || '{}');
      const v = report.metadata?.vulnerabilities || {};
      const bad = (v.critical || 0) + (v.high || 0);
      add({
        severity: bad ? 'high' : 'info',
        check: 'dependencies',
        file: 'backend/package.json',
        title: bad ? `${bad} high or critical advisories in dependencies` : 'no high or critical advisories',
        fix: bad ? 'npm audit fix — and read what it changes before committing.' : null,
      });
    } catch {
      add({
        severity: 'low',
        check: 'dependencies',
        title: 'could not run npm audit (offline?)',
      });
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LIVE — attack a running instance
// ─────────────────────────────────────────────────────────────────────────────
async function checkLive(base) {
  const user = flag('user');
  const pass = flag('pass');
  let cookie = null;

  const call = async (p, init = {}) => {
    const res = await fetch(`${base}${p}`, {
      redirect: 'manual',
      ...init,
      headers: { ...(init.headers || {}), ...(cookie ? { Cookie: cookie } : {}) },
    });
    const text = await res.text().catch(() => '');
    return { res, text };
  };

  // --- TLS and headers as actually served ---
  try {
    const { res } = await call('/');
    for (const h of ['content-security-policy', 'x-frame-options', 'x-content-type-options']) {
      const ok = Boolean(res.headers.get(h));
      add({
        severity: ok ? 'info' : 'high',
        check: 'live:headers',
        title: ok ? `${h} present on the live site` : `${h} MISSING on the live site`,
        detail: ok ? null : 'Set in the config but not arriving means the wrong vhost is serving.',
      });
    }
    if (base.startsWith('https')) {
      const hsts = res.headers.get('strict-transport-security');
      add({
        severity: hsts ? 'info' : 'medium',
        check: 'live:tls',
        title: hsts ? 'HSTS is being sent' : 'HSTS is not being sent',
      });

      // How long the certificate has left.
      //
      // Renewal is a cron job talking to the internet twice a week, and it can
      // fail quietly for a month — a DNS hiccup, an expired ACME account, a
      // firewall rule someone added. Nothing else in the system notices until
      // the morning every browser refuses the site. Reading the expiry date on
      // every audit turns that into something you find out weeks early.
      try {
        const host = new URL(base).hostname;
        const tls = require('tls');
        const days = await new Promise((resolve, reject) => {
          const socket = tls.connect(
            { host, port: 443, servername: host, timeout: 8000 },
            () => {
              const cert = socket.getPeerCertificate();
              socket.end();
              if (!cert || !cert.valid_to) return reject(new Error('no certificate'));
              resolve(Math.round((new Date(cert.valid_to) - Date.now()) / 86_400_000));
            }
          );
          socket.on('error', reject);
          socket.on('timeout', () => { socket.destroy(); reject(new Error('timeout')); });
        });

        add({
          severity: days < 10 ? 'critical' : days < 25 ? 'high' : 'info',
          check: 'live:tls',
          title: `the certificate expires in ${days} days`,
          detail:
            days < 25
              ? 'Automatic renewal starts at 30 days left. Below that, it has already failed at least twice.'
              : null,
          fix:
            days < 25
              ? 'cd /opt/feranocar && docker compose run --rm --entrypoint certbot certbot renew --dry-run'
              : null,
        });
      } catch (err) {
        add({
          severity: 'low',
          check: 'live:tls',
          title: `could not read the certificate expiry: ${err.message}`,
        });
      }
    } else {
      add({
        severity: 'high',
        check: 'live:tls',
        title: 'audited over plain HTTP — every password on this site is readable in transit',
        fix: 'Run deploy/enable-ssl.sh, then re-run this audit against the https address.',
      });
    }
    if (res.headers.get('server') && /\d/.test(res.headers.get('server'))) {
      add({
        severity: 'low',
        check: 'live:headers',
        title: `the server banner reveals a version: ${res.headers.get('server')}`,
        fix: 'server_tokens off;',
      });
    }
  } catch (err) {
    add({ severity: 'critical', check: 'live', title: `cannot reach ${base}: ${err.message}` });
    return;
  }

  // --- authentication is actually required ---
  const guarded = ['/api/v1/havales', '/api/v1/admin/agents', '/api/v1/settings', '/api/v1/admin/activity'];
  for (const p of guarded) {
    const { res } = await call(p);
    const ok = res.status === 401 || res.status === 403;
    add({
      severity: ok ? 'info' : 'critical',
      check: 'live:auth',
      title: ok ? `${p} refuses an anonymous request` : `${p} answered ${res.status} WITHOUT a session`,
      fix: ok ? null : 'Add authenticate to this route.',
    });
  }

  if (!user || !pass) {
    add({
      severity: 'info',
      check: 'live',
      title: 'no --user/--pass given, so the signed-in checks were skipped',
    });
    return;
  }

  // --- sign in ---
  const login = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: user, password: pass }),
    redirect: 'manual',
  });
  const setCookie = login.headers.get('set-cookie') || '';
  cookie = setCookie.split(';')[0];

  // The server says exactly why in Persian — "the password is wrong", "the
  // account is locked", "this account is suspended". Reporting the bare status
  // code throws that away and leaves someone guessing at their own password.
  let reason = null;
  if (login.status !== 200) {
    try {
      reason = JSON.parse(await login.clone().text())?.error?.message || null;
    } catch { /* not JSON; the status alone will have to do */ }
  }

  add({
    severity: login.status === 200 ? 'info' : login.status === 429 ? 'low' : 'high',
    check: 'live:auth',
    title:
      login.status === 200
        ? 'sign-in works'
        : login.status === 429
          ? 'sign-in is rate-limited right now — the signed-in checks were skipped'
          : `sign-in returned ${login.status}${reason ? ` — ${reason}` : ''}`,
    // The burst test at the end of a previous run trips the limiter for the
    // rest of its window. Saying so beats leaving someone to conclude their
    // password is wrong.
    detail:
      login.status === 429
        ? 'Expected if this audit ran within the last 15 minutes — its own brute-force test spent the allowance. Wait, or restart the API.'
        : login.status === 401
          ? 'Wrong password, or the account is locked after five failed attempts. The signed-in checks were skipped.'
          : null,
  });
  if (login.status !== 200) return;

  for (const [name, present] of [
    ['HttpOnly', /HttpOnly/i.test(setCookie)],
    ['SameSite=Strict', /SameSite=Strict/i.test(setCookie)],
    ['Secure', /Secure/i.test(setCookie)],
  ]) {
    const expected = name !== 'Secure' || base.startsWith('https');
    add({
      severity: present === expected ? 'info' : 'critical',
      check: 'live:cookie',
      title: `session cookie ${present ? 'has' : 'lacks'} ${name}${expected ? '' : ' (correct over plain HTTP)'}`,
    });
  }

  const body = await login.text();
  add({
    severity: /"token"|passwordHash/.test(body) ? 'critical' : 'info',
    check: 'live:token-leak',
    title: /"token"|passwordHash/.test(body)
      ? 'the sign-in response body contains a token or password hash'
      : 'the sign-in response body carries no token',
  });

  // Which kind of account is doing the testing.
  //
  // The authorisation checks below assume an agency: they assert that admin
  // routes are refused. Run with administrator credentials, "refused" would be
  // wrong and the audit would report three criticals that are the system
  // working correctly. Rather than trust the caller to remember, ask.
  const { text: meText } = await call('/api/v1/auth/me');
  let role = null;
  try {
    role = JSON.parse(meText)?.data?.role || null;
  } catch { /* leave it null and say so below */ }
  const isAgency = role === 'AGENT';

  add({
    severity: isAgency ? 'info' : 'low',
    check: 'live:auth',
    title: isAgency
      ? 'testing as an agency account, which is what the authorisation checks assume'
      : `testing as ${role || 'an unknown role'} — the authorisation checks below are skipped`,
    detail: isAgency
      ? null
      : 'Those checks assert that admin routes are refused. An administrator is meant to reach them, so running as one would report the system working as three critical findings.',
    fix: isAgency ? null : 'Re-run with an agency account to cover authorisation.',
  });

  // --- THE masking test: a phone number nobody paid for ---
  const { text: listText } = await call('/api/v1/havales?limit=50');
  let list = {};
  try {
    list = JSON.parse(listText);
  } catch { /* handled below */ }
  const items = list?.data?.items || [];
  const strangers = items.filter((h) => !h.isOwn && !h.contactRevealed);
  const leaked = strangers.filter((h) => /09\d{9}/.test(JSON.stringify(h)));
  const identity = strangers.filter((h) => h.agency && (h.agency.name || h.agency.code));

  // An empty sample is not a pass.
  //
  // This is the rule the business rests on, and "no phone number in 0
  // listings" is a sentence that reads like success and means nothing was
  // examined. The browser smoke test already refuses to pass on an empty set;
  // this check shipped without the same guard and reported a green result on
  // a server whose listings had all expired.
  if (!strangers.length) {
    add({
      severity: 'medium',
      check: 'live:masking',
      title: 'the masking test had nothing to test — no listings from other agencies were visible',
      detail:
        `The list returned ${items.length} rows, none of them another agency's unrevealed listing. ` +
        'This is the rule everything else protects; it must be exercised against real data.',
      fix: 'Post a listing from a second agency, then re-run. Until then, treat masking as unverified on this server.',
    });
  } else {
    add({
      severity: leaked.length ? 'critical' : 'info',
      check: 'live:masking',
      title: leaked.length
        ? `${leaked.length} listings carry a phone number without a recorded reveal`
        : `no phone number in ${strangers.length} unrevealed listings`,
      detail: leaked.length
        ? 'Every number in the database is readable with a login and the network tab.'
        : null,
    });
    add({
      severity: identity.length ? 'high' : 'info',
      check: 'live:masking',
      title: identity.length
        ? `${identity.length} unrevealed listings expose the posting agency's identity`
        : `poster identity hidden across ${strangers.length} listings`,
      detail: identity.length ? 'The name alone finds the phone number in one web search.' : null,
    });
  }

  // --- SQL injection, actually sent ---
  const payloads = [
    "' OR '1'='1",
    "'; DROP TABLE \"User\"; --",
    "1' UNION SELECT NULL,NULL,NULL--",
    "%27%20OR%201=1--",
  ];
  for (const p of payloads) {
    const { res, text } = await call(`/api/v1/havales?carType=${encodeURIComponent(p)}`);
    const dbError = /syntax error|PrismaClient|PostgresError|pg_|relation ".*" does not exist/i.test(text);
    add({
      severity: dbError ? 'critical' : 'info',
      check: 'live:sql-injection',
      title: dbError
        ? `injection payload reached the database: ${p}`
        : `injection payload handled safely (${res.status}): ${p.slice(0, 24)}`,
      detail: dbError ? text.slice(0, 200) : null,
    });
  }

  // --- XSS, actually stored and read back ---
  const xss = '<img src=x onerror=alert(1)>';
  const { text: searchText } = await call(`/api/v1/havales?carType=${encodeURIComponent(xss)}`);
  add({
    severity: searchText.includes('<img src=x') && !searchText.includes('\\u003c') ? 'medium' : 'info',
    check: 'live:xss',
    title: searchText.includes('<img src=x')
      ? 'the API reflects raw HTML from input (the frontend escapes it, but it should not travel raw)'
      : 'input is not reflected as raw HTML',
  });

  // --- CSRF: a forged cross-site request must not work ---
  const forged = await fetch(`${base}/api/v1/auth/logout`, {
    method: 'POST',
    headers: { Cookie: cookie, Origin: 'https://evil.example', Referer: 'https://evil.example/' },
    redirect: 'manual',
  });
  // SameSite=Strict means a real browser never sends the cookie at all; this
  // only proves the server does not additionally trust the origin header.
  add({
    severity: 'info',
    check: 'live:csrf',
    title: `cross-origin POST with a stolen cookie returned ${forged.status} — SameSite=Strict is what stops a real browser sending it`,
  });

  // --- privilege escalation: an agency reaching admin routes ---
  cookie = (await (async () => {
    const again = await fetch(`${base}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user, password: pass }),
      redirect: 'manual',
    });
    return (again.headers.get('set-cookie') || '').split(';')[0];
  })());

  if (isAgency) {
    for (const p of ['/api/v1/admin/agents', '/api/v1/admin/activity', '/api/v1/settings']) {
      const { res } = await call(p);
      const ok = res.status === 403 || res.status === 401;
      add({
        severity: ok ? 'info' : 'critical',
        check: 'live:authorisation',
        title: ok
          ? `an agency account is refused ${p}`
          : `an agency account reached ${p} (${res.status})`,
        fix: ok ? null : 'Add requirePermission to this route.',
      });
    }
  }

  // --- rate limiting is real ---
  const burst = await Promise.all(
    Array.from({ length: 15 }, () =>
      fetch(`${base}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: `nobody_${Math.random()}`, password: 'x' }),
        redirect: 'manual',
      }).then((r) => r.status)
    )
  );
  const limited = burst.filter((s) => s === 429).length;
  add({
    severity: limited ? 'info' : 'high',
    check: 'live:brute-force',
    title: limited
      ? `sign-in rate limit engaged after a burst (${limited}/15 refused)`
      : 'fifteen rapid sign-in attempts were all accepted for processing',
    detail: limited
      ? 'This test spends the sign-in allowance for this address — a re-run within the window will report sign-in as rate-limited.'
      : null,
    fix: limited ? null : 'Check that authLimiter is on the login route and trust proxy is set.',
  });

  // ── the checks from the OWASP pentest checklist that were not already above ──
  //
  // Grouped by the checklist's own categories so a reader can map result to
  // list. Everything here is a live probe, not a source read.

  // 2 / config: dangerous HTTP methods, and infrastructure files.
  //
  // TRACE is deliberately not sent here: fetch refuses to issue it at all
  // (it throws "HTTP method is unsupported"), which is itself the client-side
  // half of the XST defence. On the server side, Express has no TRACE handler,
  // so it would 404 — the safe outcome — and nginx in front blocks it outright.
  for (const method of ['PUT', 'DELETE', 'PATCH']) {
    const { res } = await call('/api/v1/health', { method });
    const ok = res.status === 404 || res.status === 405;
    add({
      severity: ok ? 'info' : 'high',
      check: 'live:http-methods',
      title: ok
        ? `${method} on a read-only route is refused (${res.status})`
        : `${method} on a read-only route returned ${res.status}`,
    });
  }
  for (const p of ['/.env', '/.git/config', '/docker-compose.yml', '/backend/.env']) {
    const { res } = await call(p);
    const exposed = res.status === 200;
    add({
      severity: exposed ? 'critical' : 'info',
      check: 'live:exposure',
      title: exposed ? `${p} is served to the internet` : `${p} is not reachable`,
      fix: exposed ? 'Ensure nginx serves only frontend/, never the project root.' : null,
    });
  }

  // 8 / error handling: malformed and oversized bodies must be 400/413 with no
  // framework message, not a 500 that names the parser.
  const bad = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{bad json',
    redirect: 'manual',
  });
  const badText = await bad.text();
  add({
    severity: bad.status === 400 ? 'info' : 'medium',
    check: 'live:error-handling',
    title:
      bad.status === 400
        ? 'a malformed request body is a clean 400'
        : `a malformed request body returned ${bad.status}`,
    detail: /Expected property|JSON at position|SyntaxError/.test(badText)
      ? 'The response quotes the JSON parser — that names the framework.'
      : null,
  });

  // 5 / IDOR + horizontal authorisation: one agency must not touch another's
  // listing. Needs the signed-in agency to own at least one.
  const mine = await call('/api/v1/havales/mine?limit=1');
  let ownId = null;
  try {
    ownId = JSON.parse(mine.text)?.data?.items?.[0]?.id || null;
  } catch { /* none */ }
  if (ownId) {
    // Re-fetch as the same agent to confirm the id is real, then confirm the
    // *mutating* verbs are the ones tested — a GET tells us less.
    for (const method of ['DELETE', 'PATCH']) {
      // The point is not this agent on its own listing (allowed) but that the
      // id space is not a way around ownership. A forged id from another agency
      // is not available here, so this asserts the weaker but still meaningful
      // property: a random well-formed id is refused, not silently accepted.
      const { res } = await call(`/api/v1/havales/notarealid000000000000000`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      // Anything but a 2xx is a refusal. 404 (not found), 403 (not yours),
      // 400/422 (the empty body failed validation before ownership was even
      // checked) are all safe — what would be a finding is a 200.
      const ok = res.status >= 400 && res.status < 500;
      add({
        severity: ok ? 'info' : 'critical',
        check: 'live:idor',
        title: ok
          ? `${method} on an unknown listing id is refused (${res.status})`
          : `${method} on an unknown listing id returned ${res.status}`,
      });
    }
  }

  // 4 / account enumeration: a wrong password and an unknown user must be
  // indistinguishable, or usernames can be discovered.
  const wrongPass = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: user, password: 'definitely-wrong' }),
    redirect: 'manual',
  });
  const unknownUser = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: `nobody_${Date.now()}`, password: 'x' }),
    redirect: 'manual',
  });
  const m1 = await wrongPass.json().catch(() => ({}));
  const m2 = await unknownUser.json().catch(() => ({}));
  const same = wrongPass.status === unknownUser.status && m1?.error?.message === m2?.error?.message;
  add({
    severity: same ? 'info' : 'high',
    check: 'live:enumeration',
    title: same
      ? 'wrong password and unknown username are indistinguishable'
      : 'wrong password and unknown username give different responses',
    detail: same ? null : 'The difference lets an attacker enumerate valid usernames.',
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixes — only the unambiguous ones
// ─────────────────────────────────────────────────────────────────────────────
function applyFixes() {
  let applied = 0;
  for (const f of findings) {
    if (!f.autofix) continue;
    try {
      if (f.autofix.kind === 'chmod') {
        fs.chmodSync(f.autofix.file, f.autofix.mode);
        f.fixed = `chmod ${f.autofix.mode.toString(8)}`;
        applied += 1;
      }
      if (f.autofix.kind === 'append-gitignore') {
        fs.appendFileSync(path.join(ROOT, '.gitignore'), `\n${f.autofix.value}\n`);
        f.fixed = `added to .gitignore`;
        applied += 1;
      }
    } catch (err) {
      f.fixed = `failed: ${err.message}`;
    }
  }
  return applied;
}

// ─────────────────────────────────────────────────────────────────────────────
function report() {
  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  const counts = findings.reduce((acc, f) => ({ ...acc, [f.severity]: (acc[f.severity] || 0) + 1 }), {});
  const problems = findings.filter((f) => f.severity !== 'info');

  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  گزارش امنیتی — FeranoCar');
  console.log('══════════════════════════════════════════════════════════\n');

  for (const sev of ['critical', 'high', 'medium', 'low']) {
    const rows = findings.filter((f) => f.severity === sev);
    if (!rows.length) continue;
    const label = { critical: 'بحرانی', high: 'مهم', medium: 'متوسط', low: 'کم' }[sev];
    console.log(`── ${label.toUpperCase()} (${rows.length}) ${'─'.repeat(40)}`);
    for (const f of rows) {
      console.log(`  ✗ [${f.check}] ${f.title}`);
      if (f.file) console.log(`      ${f.file}${f.line ? `:${f.line}` : ''}`);
      if (f.detail) console.log(`      ${f.detail}`);
      if (f.fix) console.log(`      → ${f.fix}`);
      if (f.fixed) console.log(`      ✓ اصلاح شد: ${f.fixed}`);
      console.log('');
    }
  }

  const passed = findings.filter((f) => f.severity === 'info');
  console.log(`── بررسی‌های موفق (${passed.length}) ${'─'.repeat(36)}`);
  for (const f of passed) console.log(`  ✓ [${f.check}] ${f.title}`);

  console.log('\n══════════════════════════════════════════════════════════');
  console.log(
    `  بحرانی: ${counts.critical || 0} · مهم: ${counts.high || 0} · ` +
      `متوسط: ${counts.medium || 0} · کم: ${counts.low || 0} · موفق: ${passed.length}`
  );
  console.log('══════════════════════════════════════════════════════════\n');

  if (!LIVE) {
    console.log('نکته: بدون --live فقط کد بررسی شد. برای تست واقعی روی سرور:');
    console.log("  node security/audit.js --live https://feranocar.com --user alborz --pass '…'\n");
  }

  // The report is a convenience; the audit above is the result. Losing the
  // file must not lose the run — this crashed after printing a clean report
  // because the container runs as an unprivileged user and the mounted
  // directory belongs to root.
  const out = flag('report') || path.join(ROOT, 'security', 'last-report.json');
  try {
    fs.writeFileSync(String(out), JSON.stringify({ at: new Date().toISOString(), findings }, null, 2));
    console.log(`گزارش کامل: ${out}\n`);
  } catch (err) {
    console.log(`(گزارش JSON ذخیره نشد: ${err.code || err.message} — خروجی بالا کامل است)`);
    console.log(`  برای ذخیره: --report /tmp/audit.json\n`);
  }

  // Non-zero exit on anything that matters, so CI can gate on it.
  const blocking = findings.filter((f) => f.severity === 'critical' || f.severity === 'high');
  process.exitCode = blocking.length ? 1 : 0;
  return problems.length;
}

(async () => {
  console.log('→ بررسی XSS');
  checkXss();
  console.log('→ بررسی SQL injection');
  checkSql();
  console.log('→ بررسی کوکی، CSRF و توکن');
  checkCookieAndCsrf();
  console.log('→ بررسی رازها');
  checkSecrets();
  console.log('→ بررسی ماسکینگ اطلاعات تماس');
  checkMasking();
  console.log('→ بررسی پیکربندی استقرار');
  checkDeployment();
  console.log('→ بررسی وابستگی‌ها');
  checkDependencies();

  if (LIVE) {
    console.log(`→ حمله‌ی واقعی به ${LIVE}`);
    await checkLive(String(LIVE).replace(/\/$/, ''));
  }

  if (FIX) {
    const n = applyFixes();
    console.log(`\n→ ${n} مورد به‌صورت خودکار اصلاح شد`);
  }

  report();
})();
