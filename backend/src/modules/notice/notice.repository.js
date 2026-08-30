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

  /**
   * This agency's listings that an admin has taken down, with the reason.
   *
   * A separate source from the strike list, because a suspension does not need
   * a report behind it: an admin can take a listing down directly, and the
   * refusal that asks them for a reason says «نماینده همین متن را می‌بیند».
   * Until this existed, nobody did.
   */
  suspendedListings(ownerId, take = 50) {
    return prisma.listing.findMany({
      where: { ownerId, status: 'SUSPENDED', suspendedAt: { not: null }, deletedAt: null },
      select: {
        id: true,
        serial: true,
        carType: true,
        market: true,
        suspendReason: true,
        suspendedAt: true,
      },
      orderBy: { suspendedAt: 'desc' },
      take,
    });
  },

  /**
   * The same set, counted — minus the ones a strike already speaks for.
   *
   * A suspension that came from an upheld report is announced by the strike
   * notice, which says more: which report, on what grounds, and which strike of
   * three. Counting it twice would make the badge say «۲» over a box holding
   * one card.
   */
  countSuspendedSince(ownerId, since) {
    return prisma.listing.count({
      where: {
        ownerId,
        status: 'SUSPENDED',
        deletedAt: null,
        suspendedAt: since ? { gt: since } : { not: null },
        reports: { none: { status: 'CONFIRMED' } },
      },
    });
  },

  setSeenAt(userId, at) {
    return prisma.user.update({ where: { id: userId }, data: { noticesSeenAt: at } });
  },
};

module.exports = noticeRepository;
