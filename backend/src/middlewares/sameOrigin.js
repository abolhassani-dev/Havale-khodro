const config = require('../config');
const { ForbiddenError } = require('../errors/AppError');
const { ERROR_CODES } = require('../constants/errorCodes');

/**
 * A write must come from this site.
 *
 * The session cookie is SameSite=Strict, which already stops a foreign page
 * from making the browser attach it. This is the second lock on the same
 * door, for the cases Strict does not cover: a sibling host under the same
 * registrable domain (same *site*, different origin), a plain-HTTP interlude
 * before TLS was switched on, or a browser that does not honour the attribute.
 *
 * Browsers put an Origin header on every cross-origin request and on every
 * same-origin POST/PUT/PATCH/DELETE made by fetch or a form; older ones send
 * a Referer instead. When either is present it has to name this host or one
 * of the configured CORS origins. When neither is present the caller is not a
 * browser — curl, the smoke tests' API client, a job — and has no cookie a
 * foreign page could have borrowed, so it passes.
 *
 * Only state-changing methods: a GET never changes anything here (verified
 * when the API was reviewed), and blocking reads would break bookmarks.
 */
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function hostOf(value) {
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return null;
  }
}

function sameOrigin(req, _res, next) {
  if (!UNSAFE.has(req.method)) return next();

  const source = req.get('origin') || req.get('referer');
  if (!source || source === 'null') return next();

  const from = hostOf(source);
  const here = String(req.get('host') || '').toLowerCase();
  const allowed = config.security.corsOrigins.map(hostOf).filter(Boolean);

  if (from && (from === here || allowed.includes(from))) return next();

  return next(
    new ForbiddenError('درخواست از دامنه‌ی دیگری آمده و پذیرفته نمی‌شود.', ERROR_CODES.FORBIDDEN)
  );
}

module.exports = sameOrigin;
