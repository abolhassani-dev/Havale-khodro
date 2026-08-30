const { prisma } = require('../../config/database');

const ACTOR_SELECT = {
  select: { id: true, fullName: true, username: true, agencyCode: true, agencyName: true, role: true },
};

const monitoringRepository = {
  /**
   * Everything the dashboard puts on screen, in one round trip.
   *
   * Written as counts rather than as rows on purpose: this is the first page an
   * admin opens and it must not read a table to tell them how big it is.
   *
   * Grouped the way the screen is: what is waiting for somebody, what state the
   * market is in, and what people are actually asking about.
   */
  async overview() {
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const weekAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const [
      agencies,
      activeAgencies,
      suspendedAgencies,
      newAgencies,
      liveByMarket,
      revealsToday,
      revealsWeek,
      revealsPrevWeek,
      pendingReports,
      thirdStrike,
      openTickets,
      pendingSeatOrders,
      liveSubs,
      expiringSubs,
      topCars,
    ] = await Promise.all([
      prisma.user.count({ where: { role: 'AGENT' } }),
      prisma.user.count({ where: { role: 'AGENT', status: 'ACTIVE' } }),
      prisma.user.count({ where: { role: 'AGENT', status: { not: 'ACTIVE' } } }),
      prisma.user.count({ where: { role: 'AGENT', createdAt: { gte: monthAgo } } }),
      // Per market, so the tile stops saying «حواله» about a number that has
      // ثبت‌نامی in it — the mistake the agency dashboard had until today.
      prisma.listing.groupBy({
        by: ['market'],
        where: { deletedAt: null, status: 'ACTIVE', closesAt: { gt: now } },
        _count: { _all: true },
      }),
      prisma.contactReveal.count({ where: { createdAt: { gte: dayAgo } } }),
      prisma.contactReveal.count({ where: { createdAt: { gte: weekAgo } } }),
      // The week before that, so «۲۲ بازدید» can say whether that is up or down.
      // A number with nothing to compare it to is decoration.
      prisma.contactReveal.count({
        where: { createdAt: { gte: twoWeeksAgo, lt: weekAgo } },
      }),
      prisma.violationReport.count({ where: { status: 'PENDING' } }),
      prisma.violationReport.count({ where: { needsSuperApproval: true, status: 'CONFIRMED' } }),
      prisma.ticket.count({ where: { status: 'OPEN' } }),
      prisma.seatOrder.count({ where: { status: 'PENDING' } }),
      prisma.subscription.count({ where: { status: 'ACTIVE', expiresAt: { gt: now } } }),
      // Who to telephone this week. The one number on this page that is worth
      // money rather than worth knowing.
      prisma.subscription.count({
        where: { status: 'ACTIVE', expiresAt: { gt: now, lte: weekAhead } },
      }),
      this.topCars(monthAgo),
    ]);

    const byMarket = Object.fromEntries(liveByMarket.map((m) => [m.market, m._count._all]));

    return {
      agencies,
      activeAgencies,
      suspendedAgencies,
      newAgencies,
      liveListings: Object.values(byMarket).reduce((sum, n) => sum + n, 0),
      liveByMarket: byMarket,
      revealsLast24h: revealsToday,
      revealsLast7d: revealsWeek,
      revealsPrev7d: revealsPrevWeek,
      pendingReports,
      thirdStrike,
      openTickets,
      pendingSeatOrders,
      liveSubscriptions: liveSubs,
      expiringSubscriptions: expiringSubs,
      topCars: topCars.map((c) => ({
        carType: c.carType,
        reveals: c._sum.revealCount || 0,
        listings: c._count._all,
      })),
    };
  },

  /**
   * The cars people are actually asking about.
   *
   * Ranked by reveals rather than by how many advertisements exist: anybody can
   * post ten Peugeots, but a reveal is somebody spending part of their day's
   * allowance — it is the closest thing this system has to demand.
   */
  topCars(since, take = 6) {
    return prisma.listing.groupBy({
      by: ['carType'],
      where: { createdAt: { gte: since }, deletedAt: null, revealCount: { gt: 0 } },
      _sum: { revealCount: true },
      _count: { _all: true },
      orderBy: { _sum: { revealCount: 'desc' } },
      take,
    });
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
