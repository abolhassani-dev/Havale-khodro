const securityService = require('../modules/security/security.service');
const { windowCounter } = require('../modules/security/counters');
const { PAYLOAD_RULES, PROBE_PATH, SCANNER_UA } = require('../modules/security/threat.rules');
const requestContext = require('../utils/requestContext');

/**
 * Watching every request for the shape of an attack.
 *
 * ── The budget ──────────────────────────────────────────────────────────────
 *
 * This runs before everything, on every request, on a three-core machine. So:
 *
 *   • the regexes are compiled once, at module load;
 *   • the URL is always scanned (it is short) and the body only when it is
 *     small enough to be worth scanning;
 *   • scanning stops at the first rule that matches — knowing somebody sent a
 *     SQL payload is the finding, and enumerating every rule it also matches
 *     adds nothing;
 *   • the counting rules use in-memory windows, so nothing touches the database
 *     until a threshold is actually crossed.
 *
 * A clean request pays for one flattening of a small object and a few regex
 * tests. A hostile one pays for a single upsert, and repeats of the same
 * hostile request pay for an increment.
 *
 * ── Detect, do not block ────────────────────────────────────────────────────
 *
 * A matched request is recorded and then continues to the normal handlers,
 * which refuse it on their own terms — validation, authentication, a 404. This
 * is deliberate. Blocking here would mean a regex standing between real
 * agencies and their work, and the day it has a false positive is the day an
 * agency cannot post a listing and nobody can explain why. The defences that
 * actually stop these attacks are elsewhere and do not depend on recognising
 * the payload.
 */

/** Bodies larger than this are not scanned. A 2MB fuzz is not worth a regex. */
const MAX_BODY_SCAN = 8 * 1024;

const WINDOWS = {
  /** Wrong passwords for one username. */
  bruteForce: windowCounter(15 * 60 * 1000),
  /** Distinct usernames tried from one address — spraying, not forgetting. */
  spray: windowCounter(30 * 60 * 1000),
  /** Refusals: 403 for a signed-in account probing where it may not go. */
  forbidden: windowCounter(10 * 60 * 1000),
  /** Misses: ids tried until one exists. */
  notFound: windowCounter(10 * 60 * 1000),
  /** Rate-limit rejections. */
  throttled: windowCounter(10 * 60 * 1000),
};

const THRESHOLDS = {
  bruteForce: 5,
  spray: 4,
  forbidden: 15,
  notFound: 40,
  throttled: 20,
};

/**
 * Every string in the body, joined.
 *
 * Depth- and size-limited, because the input is hostile by assumption: a deeply
 * nested object is a cheap way to make a recursive walk expensive, and that
 * would be a denial of service delivered through the intrusion detector.
 */
function flatten(value, depth = 0, out = []) {
  if (depth > 4 || out.length > 200) return out;

  if (typeof value === 'string') {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) flatten(item, depth + 1, out);
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      // Keys matter as much as values here: `__proto__` arrives as a key.
      out.push(key);
      flatten(item, depth + 1, out);
    }
  }
  return out;
}

/** The first rule that matches, or null. */
function match(url, body) {
  for (const rule of PAYLOAD_RULES) {
    if (rule.where !== 'body' && rule.test.test(url)) {
      return { rule, sample: url };
    }
    if (rule.where !== 'url' && body) {
      const hit = body.find((text) => rule.test.test(text));
      if (hit) return { rule, sample: hit };
    }
  }
  return null;
}

/**
 * The facts every recorded event carries.
 *
 * Taken from the request when there is one in hand, and otherwise from the
 * async-local context — because the counted rules are reported from services
 * that have no `req` and should not be given one. A call from a script or a
 * test finds nothing and records an event with no address, which is honest.
 */
const context = (req) => {
  const at = req || requestContext.current() || {};
  return {
    ip: req ? req.ip : at.ip,
    path: req ? req.originalUrl : at.path,
    method: req ? req.method : at.method,
    userAgent: req ? req.headers['user-agent'] : at.userAgent,
    userId: req?.user?.id,
  };
};

function threatDetect(req, res, next) {
  try {
    // The URL as sent *and* as decoded: `%2e%2e%2f` and `../` are the same
    // attempt, and a scanner encodes precisely so that a naive check misses it.
    const raw = req.originalUrl || '';
    let readable = raw;
    try {
      readable = decodeURIComponent(raw);
    } catch {
      // A deliberately malformed escape sequence. The raw form still gets
      // scanned, which is the point.
    }
    // Matched against both spellings, recorded in the readable one. A scanner
    // encodes precisely so a naive check misses it, but `%2e%2e%2f%2e%2e%2f` on
    // the screen is a puzzle where `../../` is a sentence.
    const url = raw === readable ? raw : `${raw} ${readable}`;

    let found = null;

    if (SCANNER_UA.test(req.headers['user-agent'] || '')) {
      found = { rule: 'SCANNER_UA', sample: req.headers['user-agent'] };
    } else if (PROBE_PATH.test(url)) {
      found = { rule: 'PROBE_PATH', sample: readable };
    } else {
      const size = Number(req.headers['content-length'] || 0);
      const body = req.body && size <= MAX_BODY_SCAN ? flatten(req.body) : null;
      const hit = match(url, body);
      // A hit on the URL is reported as the readable URL, not as the pair the
      // matcher was handed.
      if (hit) found = { rule: hit.rule.id, sample: hit.sample === url ? readable : hit.sample };
    }

    // Written when the response is already on the wire, for two reasons. The
    // request never waits for a database round trip caused by the attacker —
    // which would let them slow the server down by attacking it. And by then
    // the authentication middleware has run, so a signed-in attacker is
    // recorded as an account and not merely as an address: `req.user` does not
    // exist yet at the point the payload is recognised.
    if (found) res.on('finish', () => securityService.record({ ...context(req), ...found }));
  } catch {
    // Detection must never be the reason a request fails.
  }

  return next();
}

/**
 * The counted rules, reported by the places that already know.
 *
 * Exposed as functions rather than sniffed from the response, because the
 * distinction that matters — a refused password versus a refused permission —
 * is one only the handler knows. Reading it back off a status code would guess.
 */
const threats = {
  /** A wrong password. Called by the auth service, which knows the username. */
  loginFailed(username) {
    const at = context();
    const ip = at.ip || 'unknown';

    if (WINDOWS.bruteForce.hit(`${username}`) === THRESHOLDS.bruteForce) {
      securityService.record({
        ...at,
        rule: 'BRUTE_FORCE',
        sample: `نام کاربری هدف: ${username}`,
      });
    }

    // Distinct usernames from one address. This is the dangerous one: trying
    // one common password against many accounts never trips a per-account
    // lockout, and it is how real break-ins happen.
    if (WINDOWS.spray.hitDistinct(ip, username) === THRESHOLDS.spray) {
      securityService.record({
        ...at,
        rule: 'PASSWORD_SPRAY',
        sample: `${THRESHOLDS.spray} نام کاربری مختلف از یک آی‌پی`,
      });
    }
  },

  /** A signed-in account reaching for something it may not have. */
  forbidden(req) {
    const key = req.user?.id || req.ip || 'unknown';
    if (WINDOWS.forbidden.hit(key) === THRESHOLDS.forbidden) {
      securityService.record({ ...context(req), rule: 'FORBIDDEN_SWEEP', sample: req.originalUrl });
    }
  },

  /** Identifiers tried one after another. */
  notFound(req) {
    const key = req.user?.id || req.ip || 'unknown';
    if (WINDOWS.notFound.hit(key) === THRESHOLDS.notFound) {
      securityService.record({ ...context(req), rule: 'NOT_FOUND_SWEEP', sample: req.originalUrl });
    }
  },

  /** The rate limiter said no. */
  throttled(req) {
    if (WINDOWS.throttled.hit(req.ip || 'unknown') === THRESHOLDS.throttled) {
      securityService.record({ ...context(req), rule: 'RATE_LIMIT', sample: req.originalUrl });
    }
  },

  /** A body over the ceiling. */
  oversize(req) {
    securityService.record({
      ...context(req),
      rule: 'OVERSIZE',
      sample: `حجم اعلام‌شده: ${req.headers['content-length'] || '؟'} بایت`,
    });
  },

  /** Tests only. */
  reset() {
    Object.values(WINDOWS).forEach((w) => w.clear());
  },
};

module.exports = threatDetect;
module.exports.threats = threats;
module.exports.THRESHOLDS = THRESHOLDS;
