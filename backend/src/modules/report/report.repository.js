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
      prisma.havale.update({ where: { id: data.havaleId }, data: { reportCount: { increment: 1 } } }),
    ]);
  },

  findById(id) {
    return prisma.violationReport.findUnique({
      where: { id },
      include: { reporter: REPORTER_SELECT, havale: HAVALE_SELECT },
    });
  },

  findByHavaleAndReporter(havaleId, reporterId) {
    return prisma.violationReport.findUnique({
      where: { havaleId_reporterId: { havaleId, reporterId } },
    });
  },

  countRecentByReporter(reporterId, since) {
    return prisma.violationReport.count({ where: { reporterId, createdAt: { gte: since } } });
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
      include: { reporter: REPORTER_SELECT, havale: HAVALE_SELECT },
    });
  },

  /** Reports filed against a given agency's listings — their side of the file. */
  listAgainstOwner(ownerId, take = 50) {
    return prisma.violationReport.findMany({
      where: { havale: { ownerId }, status: 'CONFIRMED' },
      orderBy: { createdAt: 'desc' },
      take,
      include: { havale: HAVALE_SELECT },
    });
  },

  update(id, data) {
    return prisma.violationReport.update({
      where: { id },
      data,
      include: { reporter: REPORTER_SELECT, havale: HAVALE_SELECT },
    });
  },

  /**
   * Records the verdict, hides the listing and adds the strike together.
   *
   * These three are one decision. Split apart, a failure between them leaves a
   * listing suspended with no strike behind it, or a strike nobody can trace to
   * a verdict — and the strike count is what eventually suspends an account.
   */
  confirmAgainstOwner({ reportId, reviewerId, note, ownerId, needsSuperApproval, havaleId }) {
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
      prisma.havale.update({
        where: { id: havaleId },
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

  hideHavale(havaleId, reason) {
    return prisma.havale.update({
      where: { id: havaleId },
      data: { status: 'SUSPENDED', suspendReason: reason },
    });
  },

  /** Whether this agent ever opened the contact details on this listing. */
  hasRevealed(havaleId, viewerId) {
    return prisma.contactReveal.findUnique({
      where: { havaleId_viewerId: { havaleId, viewerId } },
    });
  },

  /** Includes soft-deleted rows: deleting a listing must not escape a report. */
  findHavaleIncludingDeleted(id) {
    return prisma.havale.findUnique({ where: { id }, ...HAVALE_SELECT });
  },
};

module.exports = reportRepository;
