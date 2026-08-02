const subscriptionRepository = require('./subscription.repository');
const { DEFAULT_REVEAL_LIMITS, REVEAL_PERIOD_DAYS } = require('../../constants/havale');
const { addDays } = require('../../utils/time');
const { isAdmin } = require('../../constants/roles');

/**
 * What an account is currently entitled to.
 *
 * Every rule in the access table (blueprint 7) reduces to this one question, so
 * it is answered in one place. Scattering `if (subscription.expiresAt > now)`
 * across controllers is how a system ends up allowing through one endpoint what
 * it blocks on another.
 */

const EXPIRED = Object.freeze({
  active: false,
  subscription: null,
  expiresAt: null,
  dailyLimit: 0,
  monthlyLimit: 0,
  periodStart: null,
});

/**
 * A sub-agent's expiry is never stored on their own row.
 *
 * Storing it meant that when the parent renewed, every sub-agent stayed locked
 * out until someone remembered to touch their records (review round 1, fix 1).
 * Reading it from the parent every time makes the renewal take effect at once,
 * and makes it impossible for the two to disagree.
 */
async function resolveAccess(user) {
  // Admins have no subscription and are not gated by one.
  if (isAdmin(user.role)) {
    return { ...EXPIRED, active: true, dailyLimit: Infinity, monthlyLimit: Infinity };
  }

  const own = await subscriptionRepository.findLive(user.id);
  if (!own) return EXPIRED;

  let governing = own;

  if (own.origin === 'PARENT_SEAT') {
    if (!user.parentId) return EXPIRED;
    const parent = await subscriptionRepository.findLive(user.parentId);
    // The parent's subscription lapsing takes the sub-agent down with it — the
    // seat was paid for out of the parent's period, so it cannot outlive it.
    if (!parent) return EXPIRED;
    governing = { ...own, startsAt: parent.startsAt, expiresAt: parent.expiresAt };
  }

  const plan = own.plan || {};

  return {
    active: true,
    subscription: own,
    expiresAt: governing.expiresAt,
    // A per-account override beats the plan. Support raises it for a large
    // agency without inventing a new plan for one customer (blueprint 6.4).
    dailyLimit: user.dailyRevealLimitOverride ?? plan.dailyRevealLimit ?? DEFAULT_REVEAL_LIMITS.DAILY,
    monthlyLimit:
      user.monthlyRevealLimitOverride ?? plan.monthlyRevealLimit ?? DEFAULT_REVEAL_LIMITS.MONTHLY,
    // The window the monthly cap is counted over: this subscription period, so
    // renewing early cannot be used to reset the allowance.
    periodStart: latestPeriodStart(governing),
  };
}

/**
 * The start of the period the monthly cap is counted over.
 *
 * A plan longer than thirty days still gets thirty-day windows, otherwise a
 * three-month plan would hand out one allowance for the whole quarter.
 */
function latestPeriodStart(subscription, now = new Date()) {
  const start = new Date(subscription.startsAt);
  const elapsedDays = Math.floor((now - start) / (24 * 60 * 60 * 1000));
  const periods = Math.floor(elapsedDays / REVEAL_PERIOD_DAYS);
  return addDays(start, periods * REVEAL_PERIOD_DAYS);
}

module.exports = { resolveAccess, latestPeriodStart };
