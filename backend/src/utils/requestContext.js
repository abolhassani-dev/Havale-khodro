const { AsyncLocalStorage } = require('async_hooks');

/**
 * Where the request is, for code that is nowhere near it.
 *
 * ── The problem this solves ─────────────────────────────────────────────────
 *
 * Every activity log ought to record the address it came from. There are
 * thirty-six places in this system that write one, and exactly one of them —
 * the login controller — had an `ip` to record, because that is the only one
 * with `req` in scope. Everywhere else the panel showed «IP: —», which reads
 * like the field is broken rather than never filled in.
 *
 * The two obvious fixes are both bad. Threading `req` down through every
 * service turns an HTTP detail into part of the signature of code that has no
 * business knowing HTTP exists — `registration.create(user, payload, req)` is
 * the beginning of a service that cannot be called from a script or a job.
 * Passing `ip` explicitly at all thirty-six call sites is the same mistake in
 * smaller print, and the thirty-seventh will forget.
 *
 * So: one middleware puts the few facts about the current request into
 * async-local storage, and anything running underneath can ask for them. Node
 * carries the store across `await` on its own — no library, no globals, and
 * nothing to pass.
 *
 * ── What it costs ───────────────────────────────────────────────────────────
 *
 * One small object per request and one `run()` call. AsyncLocalStorage is part
 * of the runtime and is used by every tracing tool in the ecosystem for exactly
 * this. It is not free in the way a bare function call is free, but it is far
 * below anything measurable next to a database round trip.
 *
 * ── The rule for using it ───────────────────────────────────────────────────
 *
 * `current()` may return null and callers must be fine with that. A nightly
 * job, a test, and a startup task all run outside any request — and a log line
 * written by the cron with no IP is correct, not degraded.
 */
const storage = new AsyncLocalStorage();

/** The context of the request being handled, or null outside one. */
function current() {
  return storage.getStore() || null;
}

/**
 * The browser or app, shortened.
 *
 * The raw header is a paragraph of vendor history — Chrome still calls itself
 * Mozilla and Safari and KHTML — and storing it on every row would cost more
 * than the row. What is actually asked later is "was this the same device?",
 * and for that, «موبایل · Chrome» answers as well as two hundred characters do.
 */
function describeDevice(userAgent) {
  const ua = String(userAgent || '');
  if (!ua) return null;

  const mobile = /Mobile|Android|iPhone|iPad/i.test(ua);
  const browser =
    (/Edg\//.test(ua) && 'Edge') ||
    (/OPR\/|Opera/.test(ua) && 'Opera') ||
    (/Firefox\//.test(ua) && 'Firefox') ||
    // Chrome's string contains Safari's, so Safari is only Safari when Chrome
    // is absent. Testing them the other way round labels every Chrome as
    // Safari, which is the classic version of this bug.
    (/Chrome\//.test(ua) && 'Chrome') ||
    (/Safari\//.test(ua) && 'Safari') ||
    null;

  const kind = mobile ? 'موبایل' : 'دسکتاپ';
  return browser ? `${kind} · ${browser}` : kind;
}

/** Express middleware. Everything downstream of it can call `current()`. */
function requestContext(req, res, next) {
  storage.run(
    {
      ip: req.ip || null,
      device: describeDevice(req.headers['user-agent']),
      requestId: req.id || null,
      // Carried for the security log, which has to say *what* was asked for
      // and by what — and is written from services that have no `req` either.
      path: req.originalUrl || null,
      method: req.method || null,
      userAgent: req.headers['user-agent'] || null,
    },
    next
  );
}

module.exports = { requestContext, current, describeDevice };
