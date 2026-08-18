const bcrypt = require('bcryptjs');

const config = require('../../config');
const { prisma } = require('../../config/database');
const { subagentRepository } = require('./subagent.repository');
const subscriptionService = require('../subscription/subscription.service');
const authRepository = require('../auth/auth.repository');
const brandAccess = require('../catalog/brandAccess.service');
const { MESSAGES } = require('../../constants/messages');
const { ERROR_CODES } = require('../../constants/errorCodes');
const {
  ForbiddenError,
  BadRequestError,
  NotFoundError,
  ConflictError,
} = require('../../errors/AppError');

/**
 * Module mode: a large agency running its own sub-agencies.
 *
 * The parent does all of this without us. That is the point of the feature — an
 * agency with fifty sub-agents should not have to open a ticket to create one.
 * What the parent may *not* do is see inside those accounts: their listings and
 * the contacts they have opened are their own (blueprint 4.6).
 */

/**
 * Sub-agency codes are derived from the parent's: G-1024 → G-1024-07.
 *
 * Derived rather than free: the code is what a violation report points at, so it
 * has to say which sub-agency of which parent without anybody having to look it
 * up (blueprint 2.3).
 */
async function nextAgencyCode(parentCode) {
  const last = await subagentRepository.lastChildSequence(parentCode);
  return `${parentCode}-${String(last + 1).padStart(2, '0')}`;
}

const subagentService = {
  /**
   * The parent's overview: who they have, and how each is doing.
   *
   * Counts and last sign-in only. The parent gets no window into the listings
   * themselves, because a sub-agent's deals are not the parent's business
   * (blueprint 4.6).
   */
  async list(user) {
    const [children, counts, seats] = await Promise.all([
      subagentRepository.listChildren(user.id),
      subagentRepository.havaleCounts(user.id),
      subscriptionService.seatSummary(user),
    ]);

    return {
      seats,
      items: children.map((child) => ({
        ...child,
        havaleCount: counts.get(child.id) || 0,
      })),
    };
  },

  async create({ user, payload }) {
    if (!user.isReseller) throw new ForbiddenError(MESSAGES.SEAT.NOT_RESELLER);

    // One level only (blueprint 2.4). A sub-agent creating sub-agents would turn
    // one subscription into an unbounded tree.
    if (user.parentId) throw new ForbiddenError(MESSAGES.SEAT.ONE_LEVEL_ONLY);

    if (!user.agencyCode) throw new BadRequestError(MESSAGES.SEAT.PARENT_NEEDS_CODE);

    const access = await subscriptionService.resolveAccess(user);
    if (!access.active) {
      throw new ForbiddenError(MESSAGES.SUBSCRIPTION.EXPIRED, ERROR_CODES.SUBSCRIPTION_EXPIRED);
    }

    const seats = await subscriptionService.seatSummary(user);
    if (seats.available < 1) throw new ForbiddenError(MESSAGES.SEAT.NO_CAPACITY);

    const existing = await authRepository.findByUsername(payload.username);
    if (existing) throw new ConflictError(MESSAGES.SEAT.USERNAME_TAKEN);

    // The phone identifies an account, so it is unique across the whole
    // system — parents, sub-agencies, staff, all of it. Unchecked, a duplicate
    // died on the database's constraint as a bare 500 («Something went wrong»
    // on production, with the parent none the wiser). Asked first, it is an
    // answer the parent can act on.
    const phoneTaken = await subagentRepository.findByPhone(payload.phone);
    if (phoneTaken) throw new ConflictError(MESSAGES.ADMIN.PHONE_TAKEN);

    // The brands this sub-agency may post under, capped by the parent's own.
    //
    // This is the point of the whole feature: a main agency with twenty
    // sub-agencies, one per marque, configures them itself instead of opening
    // twenty tickets. `limitTo` is what keeps that safe — a parent can divide
    // what it holds and can never mint more, and the ceiling is enforced in the
    // service rather than the route so no later caller can route around it.
    //
    // Defaults to everything the parent has, which is the sensible answer for a
    // sub-agency that is simply an extra desk rather than a specialised one.
    const mine = await brandAccess.allowedSets(user.id);
    const mineModelIds = mine.modelGrants.map((g) => g.id);
    const grants = {
      brandIds: payload.brandIds ?? mine.brandIds,
      modelIds: payload.modelIds ?? (payload.brandIds ? [] : mineModelIds),
      limitTo: { brandIds: mine.brandIds, modelIds: mineModelIds },
    };
    // Checked before anything is written. This used to be discovered *after*
    // the account insert, and a refusal left a half-made child behind — an
    // account with no grants and no seat subscription, which then signed in to
    // an inexplicable «اشتراک منقضی».
    await brandAccess.validateGrants(grants);

    const passwordHash = await bcrypt.hash(payload.password, config.security.bcryptRounds);
    const agencyCode = await nextAgencyCode(user.agencyCode);

    // Account, grants, seat: one transaction. A sub-agency either exists
    // whole or not at all — the three-step version could be interrupted
    // between any two steps and leave an account that half-works.
    const child = await prisma.$transaction(async (tx) => {
      const created = await subagentRepository.create(
        {
          username: payload.username,
          passwordHash,
          phone: payload.phone,
          fullName: payload.fullName,
          role: 'AGENT',
          agencyCode,
          agencyName: payload.agencyName,
          city: payload.city,
          coordinatorName: payload.coordinatorName,
          coordinatorPhone: payload.coordinatorPhone,
          parentId: user.id,
          // The parent chose this password and therefore knows it.
          mustChangePassword: true,
        },
        tx
      );

      await brandAccess.setBrands({ userId: created.id, ...grants, db: tx });

      // The seat subscription carries no meaningful expiry of its own — it
      // always reads the parent's (blueprint 4.5).
      await subscriptionService.issueSeatSubscription({
        userId: created.id,
        planId: access.subscription.planId,
        priceToman: BigInt(seats.unitPriceToman),
        createdById: user.id,
        db: tx,
      });

      return created;
    });

    await authRepository.recordActivity({
      userId: user.id,
      action: 'SUBAGENT_CREATED',
      targetType: 'USER',
      targetId: child.id,
      summary: child.agencyCode,
    });

    return subagentRepository.findChild(user.id, child.id);
  },

  /**
   * Suspending does not release the seat until the period ends (blueprint 4.8).
   * Without that, a parent could suspend everybody on the last day of the month
   * and reactivate them on the first, and never pay for capacity at all.
   */
  async setStatus({ user, id, status }) {
    const child = await this.requireChild(user, id);

    if (child.status === status) return child;

    const updated = await subagentRepository.setStatus(child.id, status);

    if (status === 'SUSPENDED') {
      // A suspended account must stop working now, not when its session expires.
      await subagentRepository.endSessions(child.id);
    }

    await authRepository.recordActivity({
      userId: user.id,
      action: status === 'SUSPENDED' ? 'SUBAGENT_SUSPENDED' : 'SUBAGENT_ACTIVATED',
      targetType: 'USER',
      targetId: child.id,
      summary: child.agencyCode,
    });

    return updated;
  },

  /** The parent may set a sub-agent's password (blueprint 3.8). */
  async resetPassword({ user, id, password }) {
    const child = await this.requireChild(user, id);

    await subagentRepository.setPassword(child.id, await bcrypt.hash(password, config.security.bcryptRounds));
    // Whoever was signed in with the old password is signed out. If the reason
    // for the reset was that the wrong person had it, leaving their session
    // alive defeats the reset.
    await subagentRepository.endSessions(child.id);

    await authRepository.recordActivity({
      userId: user.id,
      action: 'SUBAGENT_PASSWORD_RESET',
      targetType: 'USER',
      targetId: child.id,
      summary: child.agencyCode,
    });

    return { reset: true };
  },

  async requireChild(user, id) {
    const child = await subagentRepository.findChild(user.id, id);
    // Not-found rather than forbidden: confirming that an account exists but
    // belongs to another agency is information the caller did not have.
    if (!child) throw new NotFoundError('زیرنماینده');
    return child;
  },
};

module.exports = subagentService;
module.exports.internals = { nextAgencyCode };
