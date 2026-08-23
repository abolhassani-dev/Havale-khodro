const { prisma } = require('../../config/database');

const ACTOR_SELECT = {
  select: { id: true, fullName: true, username: true, agencyCode: true, agencyName: true, role: true },
};

const monitoringRepository = {
  /** Headline numbers for the dashboard. */
  async overview() {
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [agencies, activeAgencies, liveHavales, revealsToday, pendingReports, openTickets, liveSubs] =
      await Promise.all([
        prisma.user.count({ where: { role: 'AGENT' } }),
        prisma.user.count({ where: { role: 'AGENT', status: 'ACTIVE' } }),
        prisma.listing.count({
          where: { deletedAt: null, status: 'ACTIVE', closesAt: { gt: now } },
        }),
        prisma.contactReveal.count({ where: { createdAt: { gte: dayAgo } } }),
        prisma.violationReport.count({ where: { status: 'PENDING' } }),
        prisma.ticket.count({ where: { status: 'OPEN' } }),
        prisma.subscription.count({ where: { status: 'ACTIVE', expiresAt: { gt: now } } }),
      ]);

    return {
      agencies,
      activeAgencies,
      liveHavales,
      revealsLast24h: revealsToday,
      pendingReports,
      openTickets,
      liveSubscriptions: liveSubs,
    };
  },

  listActivity({ userId, action, from, to, skip = 0, take = 50 }) {
    const where = {
      ...(userId ? { userId } : {}),
      ...(action ? { action } : {}),
      ...(from || to
        ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
        : {}),
    };

    return prisma.$transaction([
      prisma.activityLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: { user: ACTOR_SELECT },
      }),
      prisma.activityLog.count({ where }),
    ]);
  },

  findActivity(id) {
    return prisma.activityLog.findUnique({ where: { id }, include: { user: ACTOR_SELECT } });
  },

  /**
   * The reveal log: who opened whose contact details, when, and what they saw.
   *
   * This is the record the whole monitoring feature exists for. The advertiser
   * only ever sees a count (blueprint 6.9); here the identities are complete.
   */
  listReveals({ viewerId, listingId, from, to, skip = 0, take = 50 }) {
    const where = {
      ...(viewerId ? { viewerId } : {}),
      ...(listingId ? { listingId } : {}),
      ...(from || to
        ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
        : {}),
    };

    return prisma.$transaction([
      prisma.contactReveal.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          viewer: ACTOR_SELECT,
          listing: {
            select: {
              id: true,
              serial: true,
              carType: true,
              kind: true,
              owner: { select: { id: true, agencyCode: true, agencyName: true } },
            },
          },
        },
      }),
      prisma.contactReveal.count({ where }),
    ]);
  },

  /** Reveal counts per agency over a window, for the suspicious-behaviour pass. */
  revealsPerAgency(since) {
    return prisma.contactReveal.groupBy({
      by: ['viewerId'],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    });
  },

  havalesPerAgency(since) {
    return prisma.listing.groupBy({
      by: ['ownerId'],
      where: { createdAt: { gte: since }, deletedAt: null },
      _count: { _all: true },
    });
  },

  agenciesByIds(ids) {
    return prisma.user.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        agencyCode: true,
        agencyName: true,
        city: true,
        status: true,
        fakeStrikes: true,
      },
    });
  },

  findHavale(id) {
    return prisma.listing.findUnique({
      where: { id },
      select: {
        id: true,
        serial: true,
        carType: true,
        kind: true,
        status: true,
        amountToman: true,
        owner: { select: { id: true, agencyCode: true, agencyName: true, city: true } },
      },
    });
  },

  findUserBrief(id) {
    return prisma.user.findUnique({ where: { id }, ...ACTOR_SELECT });
  },
};

module.exports = monitoringRepository;
