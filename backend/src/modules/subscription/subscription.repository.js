const { prisma } = require('../../config/database');

const subscriptionRepository = {
  /**
   * The subscription that decides what this account may do right now.
   *
   * Newest first: an account renewed early has two rows that both look live, and
   * the later one is the one that governs.
   */
  findLive(userId) {
    return prisma.subscription.findFirst({
      where: { userId, status: 'ACTIVE', expiresAt: { gt: new Date() } },
      orderBy: { expiresAt: 'desc' },
      include: { plan: true },
    });
  },

  findParent(userId) {
    return prisma.user.findUnique({ where: { id: userId }, select: { parentId: true } });
  },

  listForUser(userId) {
    return prisma.subscription.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { plan: true },
    });
  },

  findPlan(planId) {
    return prisma.plan.findFirst({ where: { id: planId, isActive: true } });
  },

  listPlans() {
    return prisma.plan.findMany({ where: { isActive: true }, orderBy: { priceToman: 'asc' } });
  },

  create(data, db = prisma) {
    return db.subscription.create({ data, include: { plan: true } });
  },

  /**
   * Ends any other live subscription for this account in the same statement that
   * the new one is created.
   *
   * Two live subscriptions would each look authoritative, and `findLive` would
   * pick between them by expiry date — so a renewal on a shorter plan could
   * silently keep the old, longer entitlement.
   */
  replaceLive(userId, data) {
    return prisma.$transaction(async (tx) => {
      await tx.subscription.updateMany({
        where: { userId, status: 'ACTIVE' },
        data: { status: 'EXPIRED' },
      });
      return tx.subscription.create({ data, include: { plan: true } });
    });
  },

  // ── seat orders ───────────────────────────────────────────────────────────

  createSeatOrder(data) {
    return prisma.seatOrder.create({ data });
  },

  findSeatOrder(id) {
    return prisma.seatOrder.findUnique({ where: { id }, include: { buyer: true } });
  },

  listSeatOrders({ buyerId, status, take = 50 }) {
    return prisma.seatOrder.findMany({
      where: { ...(buyerId ? { buyerId } : {}), ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      take,
    });
  },

  /**
   * Approving an order and granting the capacity are one operation.
   *
   * If they could come apart, the failure modes are an order marked paid that
   * granted nothing, or capacity granted twice from one payment — both of which
   * are found later by a confused customer rather than by us.
   */
  approveSeatOrder({ orderId, reviewerId, seats, buyerId, note }) {
    return prisma.$transaction([
      prisma.seatOrder.update({
        where: { id: orderId },
        data: {
          status: 'PAID',
          reviewedById: reviewerId,
          reviewedAt: new Date(),
          adminNote: note,
        },
      }),
      prisma.user.update({
        where: { id: buyerId },
        data: { seatCredits: { increment: seats } },
      }),
    ]);
  },

  rejectSeatOrder({ orderId, reviewerId, note }) {
    return prisma.seatOrder.update({
      where: { id: orderId },
      data: { status: 'REJECTED', reviewedById: reviewerId, reviewedAt: new Date(), adminNote: note },
    });
  },

  /**
   * Seats in use.
   *
   * Suspending a sub-agent part-way through a period does not release its seat
   * (blueprint 4.8) — otherwise a parent could suspend everybody on the last day
   * of the month and reactivate them on the first, and never pay for capacity.
   * So a seat counts as used if the account is active, or if it was suspended
   * inside the current period.
   */
  countSeatsUsed(parentId, periodStart) {
    return prisma.user.count({
      where: {
        parentId,
        OR: [
          { status: 'ACTIVE' },
          { status: 'SUSPENDED', suspendedAt: { gte: periodStart || new Date(0) } },
        ],
      },
    });
  },

  countActiveChildren(parentId) {
    return prisma.user.count({ where: { parentId, status: 'ACTIVE' } });
  },
};

module.exports = subscriptionRepository;
