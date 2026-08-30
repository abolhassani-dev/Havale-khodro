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

  /**
   * The searchable timeline.
   *
   * `from` is always set by the service, never optional — a `count` with no
   * date bound is a sequential scan of the whole table, and it is the reason
   * this page would have got slower every month whether anybody used it or not.
   *
   * `q` matches the agency by name or code. It costs a join, which is the right
   * price: the alternative is denormalising the agency name onto every log row
   * and then having it go stale when an agency is renamed.
   */
  listActivity({ userId, actions, q, targetId, from, to, skip = 0, take = 50 }) {
    const where = {
      createdAt: { gte: from, ...(to ? { lte: to } : {}) },
      ...(userId ? { userId } : {}),
      ...(actions?.length ? { action: { in: actions } } : {}),
      ...(targetId ? { targetId } : {}),
      ...(q
        ? {
            user: {
              OR: [
                { agencyName: { contains: q, mode: 'insensitive' } },
                { agencyCode: { contains: q, mode: 'insensitive' } },
                { fullName: { contains: q, mode: 'insensitive' } },
              ],
            },
          }
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

  /** «آگهی شماره ۱۱۳ چه سرگذشتی داشت» — the serial is what the panel shows. */
  async listingIdBySerial(serial) {
    const row = await prisma.listing.findUnique({ where: { serial }, select: { id: true } });
    return row?.id || null;
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

  /**
   * Listings per agency, with the reveals they attracted and the age of the
   * oldest one — the three numbers behind «this agency is being contacted off
   * the platform».
   *
   * One grouped query rather than a row per listing: this runs on a page an
   * admin opens, and the whole point of the check is that it costs almost
   * nothing to keep asking.
   */
  listingsPerAgency(since) {
    return prisma.listing.groupBy({
      by: ['ownerId'],
      where: { createdAt: { gte: since }, deletedAt: null },
      _count: { _all: true },
      _sum: { revealCount: true },
      _min: { createdAt: true },
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

  /** The few facts a timeline row shows about the listing it points at. */
  findListing(id) {
    return prisma.listing.findUnique({
      where: { id },
      select: {
        id: true,
        serial: true,
        market: true,
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
