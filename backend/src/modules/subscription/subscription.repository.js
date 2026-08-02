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
    return prisma.user.findUnique({
      where: { id: userId },
      select: { parentId: true },
    });
  },
};

module.exports = subscriptionRepository;
