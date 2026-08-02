const subscriptionService = require('../modules/subscription/subscription.service');
const { ForbiddenError } = require('../errors/AppError');
const { ERROR_CODES } = require('../constants/errorCodes');
const { MESSAGES } = require('../constants/messages');

/**
 * Puts the account's current entitlement on the request.
 *
 * Read-only routes still need it, because an expired subscription does not lose
 * the list — it loses the contact details inside it. The serialiser reads
 * `req.access.active` to decide what to include.
 */
async function attachAccess(req, _res, next) {
  try {
    req.access = await subscriptionService.resolveAccess(req.user);
    return next();
  } catch (err) {
    return next(err);
  }
}

/**
 * Guards the routes that the access table marks as subscription-only: creating,
 * editing and renewing a listing, and filing a violation report.
 *
 * The distinct error code matters — the interface shows a renew prompt for this
 * and a generic "not allowed" for anything else, and it cannot tell them apart
 * from the status alone.
 */
function requireActiveSubscription(req, _res, next) {
  if (!req.access) return next(new Error('attachAccess must run before requireActiveSubscription'));
  if (!req.access.active) {
    return next(
      new ForbiddenError(MESSAGES.SUBSCRIPTION.EXPIRED, ERROR_CODES.SUBSCRIPTION_EXPIRED)
    );
  }
  return next();
}

module.exports = { attachAccess, requireActiveSubscription };
