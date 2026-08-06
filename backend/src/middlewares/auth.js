const authService = require('../modules/auth/auth.service');
const authRepository = require('../modules/auth/auth.repository');
const { UnauthorizedError, ForbiddenError } = require('../errors/AppError');
const { ERROR_CODES } = require('../constants/errorCodes');
const { MESSAGES } = require('../constants/messages');
const { userCan, isAdmin, ROLES } = require('../constants/roles');
const config = require('../config');

const COOKIE_NAME = config.session.cookieName;

/** Reads the session cookie, resolves it, and attaches the user to the request. */
async function authenticate(req, _res, next) {
  try {
    const token = req.cookies[COOKIE_NAME];
    const { session, user } = await authService.resolveSession(token);

    req.user = user;
    req.session = session;
    req.sessionToken = token;

    // Fire and forget: knowing a session is alive is useful, but the user should
    // never wait on the write, and a failure here must not fail their request.
    authRepository.touchSession(session.id).catch(() => {});

    return next();
  } catch (err) {
    return next(err);
  }
}

/**
 * Blocks everything except the change-password endpoint until the initial
 * admin-set password has been replaced. Without this the forced change is
 * advisory, and a user can simply navigate past it.
 */
function requirePasswordChanged(req, _res, next) {
  if (req.user && req.user.mustChangePassword) {
    return next(
      new ForbiddenError(MESSAGES.AUTH.MUST_CHANGE_PASSWORD, ERROR_CODES.MUST_CHANGE_PASSWORD)
    );
  }
  return next();
}

/** Restricts a route to specific roles. */
function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(new UnauthorizedError());
    if (!roles.includes(req.user.role)) return next(new ForbiddenError());
    return next();
  };
}

/** Restricts a route to any admin role. */
function requireAdmin(req, _res, next) {
  if (!req.user) return next(new UnauthorizedError());
  if (!isAdmin(req.user.role)) return next(new ForbiddenError());
  return next();
}

/**
 * Checks a named permission rather than comparing role strings at the call
 * site, so the whole policy stays readable in one file and a role change does
 * not mean hunting through routes.
 *
 * Asked of the *user*, not the role: a role is the default, and an account may
 * carry ticks that differ from it. Checking the role alone would have made the
 * per-account boxes decorative — every one of these twenty-seven routes would
 * still have answered on the role.
 */
function requirePermission(permission) {
  return (req, _res, next) => {
    if (!req.user) return next(new UnauthorizedError());
    if (!userCan(req.user, permission)) return next(new ForbiddenError());
    return next();
  };
}

module.exports = {
  authenticate,
  requirePasswordChanged,
  requireRole,
  requireAdmin,
  requirePermission,
  ROLES,
};
