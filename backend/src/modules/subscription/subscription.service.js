const subscriptionRepository = require('./subscription.repository');
const settingsService = require('../settings/settings.service');
const authRepository = require('../auth/auth.repository');
const { DEFAULT_REVEAL_LIMITS, REVEAL_PERIOD_DAYS } = require('../../constants/havale');
const { addDays } = require('../../utils/time');
const { isAdmin } = require('../../constants/roles');
const { MESSAGES } = require('../../constants/messages');
const { BadRequestError, NotFoundError, ForbiddenError } = require('../../errors/AppError');

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

/**
 * Everything the agent's own subscription page needs.
 *
 * A sub-agent is shown the parent's expiry, because that is the date that
 * actually governs them — showing the date on their own row would be a number
 * that means nothing and contradicts what they experience.
 */
async function statusFor(user) {
  const access = await resolveAccess(user);
  const history = await subscriptionRepository.listForUser(user.id);

  return {
    active: access.active,
    expiresAt: access.expiresAt,
    daysLeft: access.expiresAt
      ? Math.max(0, Math.ceil((access.expiresAt - Date.now()) / (24 * 60 * 60 * 1000)))
      : 0,
    plan: access.subscription ? planSummary(access.subscription.plan) : null,
    // A seat is governed by the parent, and the page has to say so — otherwise a
    // sub-agent locked out by their parent's lapse has no way to understand why.
    dependsOnParent: Boolean(access.subscription && access.subscription.origin === 'PARENT_SEAT'),
    limits: { daily: access.dailyLimit, monthly: access.monthlyLimit },
    periodStart: access.periodStart,
    history: history.map((s) => ({
      id: s.id,
      startsAt: s.startsAt,
      expiresAt: s.expiresAt,
      status: s.status,
      origin: s.origin,
      priceToman: Number(s.priceToman),
      plan: planSummary(s.plan),
    })),
  };
}

function planSummary(plan) {
  if (!plan) return null;
  return {
    id: plan.id,
    name: plan.name,
    durationDays: plan.durationDays,
    priceToman: Number(plan.priceToman),
    dailyRevealLimit: plan.dailyRevealLimit,
    monthlyRevealLimit: plan.monthlyRevealLimit,
  };
}

/**
 * Grants or renews a subscription. Admin only — payment in phase one is a bank
 * transfer confirmed by hand (blueprint 4.3).
 *
 * Renewing runs from now rather than from the old expiry date. An agency that
 * renews a week late has been without service for that week, and dating the new
 * period from the lapse would silently charge them for it.
 */
async function grant({ actor, userId, planId, note }) {
  const plan = await subscriptionRepository.findPlan(planId);
  if (!plan) throw new NotFoundError('پلن');

  const subscription = await subscriptionRepository.replaceLive(userId, {
    userId,
    planId: plan.id,
    startsAt: new Date(),
    expiresAt: addDays(new Date(), plan.durationDays),
    priceToman: plan.priceToman,
    origin: 'ADMIN',
    createdById: actor.id,
    note,
  });

  await authRepository.recordActivity({
    userId: actor.id,
    action: 'SUBSCRIPTION_GRANTED',
    targetType: 'USER',
    targetId: userId,
    summary: plan.name,
  });

  return {
    id: subscription.id,
    startsAt: subscription.startsAt,
    expiresAt: subscription.expiresAt,
    plan: planSummary(subscription.plan),
  };
}

/**
 * Issues the seat subscription that comes with a sub-agent account.
 *
 * No expiry is computed here on purpose. The row needs a date because the column
 * is not nullable, but `resolveAccess` never reads it for a seat — it goes to
 * the parent every time (blueprint 4.5). The far-future date is a placeholder,
 * not a promise.
 */
function issueSeatSubscription({ userId, planId, priceToman, createdById }) {
  return subscriptionRepository.create({
    userId,
    planId,
    startsAt: new Date(),
    expiresAt: addDays(new Date(), 3650),
    priceToman,
    origin: 'PARENT_SEAT',
    createdById,
  });
}

// ── seat capacity ───────────────────────────────────────────────────────────

/**
 * How much capacity a reseller has, and how much of it is spoken for.
 *
 * `used` counts accounts suspended inside the current period as well as active
 * ones, because suspending mid-period does not release the seat (blueprint 4.8).
 */
async function seatSummary(user) {
  const access = await resolveAccess(user);
  const [used, active] = await Promise.all([
    subscriptionRepository.countSeatsUsed(user.id, access.periodStart),
    subscriptionRepository.countActiveChildren(user.id),
  ]);
  const unitPrice = await settingsService.get('seat.priceToman');

  return {
    isReseller: user.isReseller,
    credits: user.seatCredits,
    used,
    available: Math.max(0, user.seatCredits - used),
    activeSubAgents: active,
    unitPriceToman: Number(unitPrice),
  };
}

/**
 * What the reseller owes for the coming period.
 *
 * Their own plan plus one seat charge per active sub-agent — the 25 + 50 = 75
 * million worked through in blueprint 4.7. Recomputed from the live count each
 * time rather than stored, so it cannot drift from reality.
 */
async function invoiceFor(user) {
  const access = await resolveAccess(user);
  const [activeSubAgents, unitPrice] = await Promise.all([
    subscriptionRepository.countActiveChildren(user.id),
    settingsService.get('seat.priceToman'),
  ]);

  const planPrice = access.subscription ? BigInt(access.subscription.priceToman) : 0n;
  const seatsTotal = BigInt(activeSubAgents) * BigInt(unitPrice);

  return {
    periodEndsAt: access.expiresAt,
    lines: [
      { label: 'اشتراک نمایندگی', quantity: 1, unitToman: Number(planPrice), totalToman: Number(planPrice) },
      {
        label: 'ظرفیت زیرنمایندگی',
        quantity: activeSubAgents,
        unitToman: Number(unitPrice),
        totalToman: Number(seatsTotal),
      },
    ],
    totalToman: Number(planPrice + seatsTotal),
  };
}

/**
 * A reseller asks for capacity; an admin confirms the payment separately.
 *
 * Capacity is paid up front (blueprint 4.7), which is what stops a parent
 * running fifty sub-agents all month and suspending them before the bill.
 */
async function requestSeats({ user, seats, note }) {
  if (!user.isReseller) throw new ForbiddenError(MESSAGES.SEAT.NOT_RESELLER);

  const unitPrice = await settingsService.get('seat.priceToman');

  const order = await subscriptionRepository.createSeatOrder({
    buyerId: user.id,
    seats,
    unitPriceToman: unitPrice,
    totalToman: BigInt(seats) * BigInt(unitPrice),
    buyerNote: note,
  });

  return toSeatOrder(order);
}

async function reviewSeatOrder({ actor, orderId, approve, note }) {
  const order = await subscriptionRepository.findSeatOrder(orderId);
  if (!order) throw new NotFoundError('درخواست ظرفیت');

  // Only a pending order can be decided. Approving twice would grant the
  // capacity twice from a single payment.
  if (order.status !== 'PENDING') throw new BadRequestError(MESSAGES.SEAT.ALREADY_REVIEWED);

  if (approve) {
    await subscriptionRepository.approveSeatOrder({
      orderId,
      reviewerId: actor.id,
      seats: order.seats,
      buyerId: order.buyerId,
      note,
    });
  } else {
    await subscriptionRepository.rejectSeatOrder({ orderId, reviewerId: actor.id, note });
  }

  await authRepository.recordActivity({
    userId: actor.id,
    action: approve ? 'SEAT_ORDER_APPROVED' : 'SEAT_ORDER_REJECTED',
    targetType: 'SEAT_ORDER',
    targetId: orderId,
    summary: String(order.seats),
  });

  return toSeatOrder(await subscriptionRepository.findSeatOrder(orderId));
}

function toSeatOrder(order) {
  return {
    id: order.id,
    serial: order.serial,
    seats: order.seats,
    unitPriceToman: Number(order.unitPriceToman),
    totalToman: Number(order.totalToman),
    status: order.status,
    buyerNote: order.buyerNote,
    adminNote: order.adminNote,
    createdAt: order.createdAt,
    reviewedAt: order.reviewedAt,
  };
}

async function listSeatOrders(filters) {
  const orders = await subscriptionRepository.listSeatOrders(filters);
  return orders.map(toSeatOrder);
}

module.exports = {
  resolveAccess,
  latestPeriodStart,
  statusFor,
  grant,
  issueSeatSubscription,
  seatSummary,
  invoiceFor,
  requestSeats,
  reviewSeatOrder,
  listSeatOrders,
  planSummary,
};
