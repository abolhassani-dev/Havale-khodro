const { prisma } = require('../../config/database');

/**
 * Counts for the menu badge, and the one column notices actually store.
 *
 * Deliberately counts rather than rows: this runs on every navigation, and the
 * page that shows the notices does its own, fuller read when it is opened.
 */
const noticeRepository = {
  /** Upheld reports against this agency's listings since it last looked. */
  countStrikesSince(ownerId, since) {
    return prisma.violationReport.count({
      where: {
        listing: { ownerId },
        status: 'CONFIRMED',
        ...(since ? { reviewedAt: { gt: since } } : {}),
      },
    });
  },

  /** Reports this agency filed that have been ruled on since it last looked. */
  countFiledResolvedSince(reporterId, since) {
    return prisma.violationReport.count({
      where: {
        reporterId,
        status: { in: ['CONFIRMED', 'REJECTED', 'ABUSIVE'] },
        ...(since ? { reviewedAt: { gt: since } } : {}),
      },
    });
  },

  setSeenAt(userId, at) {
    return prisma.user.update({ where: { id: userId }, data: { noticesSeenAt: at } });
  },
};

module.exports = noticeRepository;
