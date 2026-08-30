const { prisma } = require('../../config/database');

const REPORTER_SELECT = {
  select: { id: true, agencyCode: true, agencyName: true, city: true, falseReportStrikes: true },
};

const HAVALE_SELECT = {
  select: {
    id: true,
    serial: true,
    carType: true,
    status: true,
    closesAt: true,
    deletedAt: true,
    ownerId: true,
    owner: {
      select: {
        id: true,
        agencyCode: true,
        agencyName: true,
        phone: true,
        fakeStrikes: true,
        status: true,
      },
    },
  },
};

const reportRepository = {
  create(data) {
    return prisma.$transaction([
      prisma.violationReport.create({ data }),
      prisma.listing.update({ where: { id: data.listingId }, data: { reportCount: { increment: 1 } } }),
    ]);
  },

  findById(id) {
    return prisma.violationReport.findUnique({
      where: { id },
      include: { reporter: REPORTER_SELECT, listing: HAVALE_SELECT },
    });
  },

  findByHavaleAndReporter(listingId, reporterId) {
    return prisma.violationReport.findUnique({
      where: { listingId_reporterId: { listingId, reporterId } },
    });
  },

  countRecentByReporter(reporterId, since) {
    return prisma.violationReport.count({ where: { reporterId, createdAt: { gte: since } } });
  },

  /** The queue length for the sidebar: reports nobody has ruled on yet. */
  countPending() {
    return prisma.violationReport.count({ where: { status: 'PENDING' } });
  },

  list({ status, needsSuperApproval, reporterId, take = 50 }) {
    return prisma.violationReport.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(needsSuperApproval === undefined ? {} : { needsSuperApproval }),
        ...(reporterId ? { reporterId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take,
      include: { reporter: REPORTER_SELECT, listing: HAVALE_SELECT },
    });
  },

  /** Reports filed against a given agency's listings — their side of the file. */
  listAgainstOwner(ownerId, take = 50) {
    return prisma.violationReport.findMany({
      where: { listing: { ownerId }, status: 'CONFIRMED' },
      orderBy: { createdAt: 'desc' },
      take,
      include: { listing: HAVALE_SELECT },
    });
  },

  update(id, data) {
    return prisma.violationReport.update({
      where: { id },
      data,
      include: { reporter: REPORTER_SELECT, listing: HAVALE_SELECT },
    });
  },

  /**
   * Records the verdict, hides the listing and adds the strike together.
   *
   * These three are one decision. Split apart, a failure between them leaves a
   * listing suspended with no strike behind it, or a strike nobody can trace to
   * a verdict — and the strike count is what eventually suspends an account.
   */
  confirmAgainstOwner({ reportId, reviewerId, note, ownerId, needsSuperApproval, listingId }) {
    return prisma.$transaction([
      prisma.violationReport.update({
        where: { id: reportId },
        data: {
          status: 'CONFIRMED',
          reviewedById: reviewerId,
          reviewedAt: new Date(),
          adminNote: note,
          needsSuperApproval,
        },
      }),
      prisma.listing.update({
        where: { id: listingId },
        data: { status: 'SUSPENDED', suspendReason: 'گزارش تخلف تأیید شد' },
      }),
      prisma.user.update({ where: { id: ownerId }, data: { fakeStrikes: { increment: 1 } } }),
    ]);
  },

  markAbusive({ reportId, reviewerId, note, reporterId, needsSuperApproval }) {
    return prisma.$transaction([
      prisma.violationReport.update({
        where: { id: reportId },
        data: {
          status: 'ABUSIVE',
          reviewedById: reviewerId,
          reviewedAt: new Date(),
          adminNote: note,
          needsSuperApproval,
        },
      }),
      prisma.user.update({
        where: { id: reporterId },
        data: { falseReportStrikes: { increment: 1 } },
      }),
    ]);
  },

  suspendAccount(userId) {
    return prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        // The subscription is untouched: the account is suspended, not refunded
        // and not cancelled (blueprint decision 24).
        data: { status: 'SUSPENDED', suspendedAt: new Date() },
      }),
      prisma.authSession.updateMany({
        where: { userId, endedAt: null },
        data: { endedAt: new Date(), endReason: 'ADMIN_REVOKED' },
      }),
    ]);
  },

  hideHavale(listingId, reason) {
    return prisma.listing.update({
      where: { id: listingId },
      data: { status: 'SUSPENDED', suspendReason: reason },
    });
  },

  /** Whether this agent ever opened the contact details on this listing. */
  hasRevealed(listingId, viewerId) {
    return prisma.contactReveal.findUnique({
      where: { listingId_viewerId: { listingId, viewerId } },
    });
  },

  /** Includes soft-deleted rows: deleting a listing must not escape a report. */
  findHavaleIncludingDeleted(id) {
    return prisma.listing.findUnique({ where: { id }, ...HAVALE_SELECT });
  },
};

module.exports = reportRepository;
