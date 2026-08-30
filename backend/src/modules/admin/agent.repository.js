const { prisma } = require('../../config/database');

/**
 * Agency accounts, from the admin side.
 *
 * The select list is explicit and never includes `passwordHash`. Returning the
 * whole row and trusting a serialiser downstream is exactly how a hash ends up
 * in a response nobody thought to check.
 */
const AGENT_SELECT = {
  id: true,
  username: true,
  fullName: true,
  phone: true,
  role: true,
  status: true,
  agencyCode: true,
  agencyName: true,
  city: true,
  coordinatorName: true,
  coordinatorPhone: true,
  isReseller: true,
  seatCredits: true,
  parentId: true,
  dailyRevealLimitOverride: true,
  monthlyRevealLimitOverride: true,
  fakeStrikes: true,
  falseReportStrikes: true,
  adminNote: true,
  mustChangePassword: true,
  suspendedAt: true,
  lastLoginAt: true,
  createdAt: true,
};

// What a sub-agency row shows nested under its parent — and what the file
// page lists for a parent's children. No phone: nothing encrypted crosses
// here, so the relation needs no decrypt pass.
const CHILD_ROW_SELECT = {
  id: true,
  agencyCode: true,
  agencyName: true,
  fullName: true,
  city: true,
  status: true,
  lastLoginAt: true,
  fakeStrikes: true,
  falseReportStrikes: true,
};

const agentRepository = {
  AGENT_SELECT,

  create(data) {
    return prisma.user.create({ data, select: AGENT_SELECT });
  },

  findById(id) {
    return prisma.user.findUnique({
      where: { id },
      select: {
        ...AGENT_SELECT,
        // The file page shows where an account sits in the hierarchy: a
        // child names its parent, a parent lists its children.
        parent: { select: { id: true, agencyCode: true, agencyName: true } },
        children: { select: CHILD_ROW_SELECT, orderBy: { agencyCode: 'asc' } },
      },
    });
  },

  update(id, data) {
    return prisma.user.update({ where: { id }, data, select: AGENT_SELECT });
  },

  /**
   * Search across the fields somebody on the phone would actually quote: an
   * agency code, a name, a mobile number.
   */
  list({ query, status, city, isReseller, expiring, skip = 0, take = 25 }) {
    // The phone column is encrypted at rest, so substring search on it is
    // impossible by design — `contains` used to sit in this list and turned
    // every text search into a 500. A query that is a whole mobile number
    // still finds its account, through the blind index's exact match.
    const textMatch = (q) => [
      { agencyCode: { contains: q, mode: 'insensitive' } },
      { agencyName: { contains: q, mode: 'insensitive' } },
      { fullName: { contains: q, mode: 'insensitive' } },
      { username: { contains: q, mode: 'insensitive' } },
      ...(/^09\d{9}$/.test(q) ? [{ phone: q }] : []),
    ];

    // Top-level agencies only: sub-agencies ride along under their parent, so
    // the page reads as the hierarchy it is. A query that matches a child
    // surfaces the parent — with the child visible beneath it.
    const where = {
      role: 'AGENT',
      parentId: null,
      ...(status ? { status } : {}),
      ...(city ? { city } : {}),
      ...(isReseller === undefined ? {} : { isReseller }),
      // «Whose subscription runs out this week» — the list somebody works
      // through with a telephone. Its own parameter rather than a value of
      // `status`, because `status` is the state of the *account* and this is
      // the state of a subscription: putting them in one field made the
      // dashboard's own link ask for an account status called «EXPIRING» and
      // get a 422 for it.
      ...(expiring
        ? {
            subscriptions: {
              some: {
                status: 'ACTIVE',
                expiresAt: { gt: new Date(), lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
              },
            },
          }
        : {}),
      ...(query
        ? { OR: [...textMatch(query), { children: { some: { OR: textMatch(query) } } }] }
        : {}),
    };

    return prisma.$transaction([
      prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        // A count, not the children themselves: the list stays a list of
        // central agencies, and the family is opened from the agency's file.
        select: { ...AGENT_SELECT, _count: { select: { children: true } } },
      }),
      prisma.user.count({ where }),
    ]);
  },

  findByUsername(username) {
    return prisma.user.findUnique({ where: { username }, select: { id: true } });
  },

  findByAgencyCode(agencyCode) {
    return prisma.user.findUnique({ where: { agencyCode }, select: { id: true } });
  },

  findByPhone(phone) {
    return prisma.user.findUnique({ where: { phone }, select: { id: true } });
  },

  endSessions(userId, reason = 'ADMIN_REVOKED') {
    return prisma.authSession.updateMany({
      where: { userId, endedAt: null },
      data: { endedAt: new Date(), endReason: reason },
    });
  },

  /**
   * Suspending an account also ends its sessions, in one transaction.
   *
   * Split apart, an account could be marked suspended while its session kept
   * working until somebody noticed — which for a fraudulent account is the
   * window that matters.
   */
  suspend(userId) {
    return prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        // The subscription is untouched: suspended, not refunded (decision 24).
        data: { status: 'SUSPENDED', suspendedAt: new Date() },
        select: AGENT_SELECT,
      }),
      prisma.authSession.updateMany({
        where: { userId, endedAt: null },
        data: { endedAt: new Date(), endReason: 'ADMIN_REVOKED' },
      }),
    ]);
  },

  /** Headline counts for one agency, for the detail page. */
  async stats(userId) {
    const [havales, activeHavales, reveals, reportsFiled, reportsAgainst] = await Promise.all([
      prisma.listing.count({ where: { ownerId: userId, deletedAt: null } }),
      prisma.listing.count({ where: { ownerId: userId, deletedAt: null, status: 'ACTIVE' } }),
      prisma.contactReveal.count({ where: { viewerId: userId } }),
      prisma.violationReport.count({ where: { reporterId: userId } }),
      prisma.violationReport.count({ where: { listing: { ownerId: userId }, status: 'CONFIRMED' } }),
    ]);
    return { havales, activeHavales, reveals, reportsFiled, reportsAgainst };
  },
};

module.exports = agentRepository;
