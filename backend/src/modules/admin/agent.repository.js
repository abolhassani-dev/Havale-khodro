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

const agentRepository = {
  AGENT_SELECT,

  create(data) {
    return prisma.user.create({ data, select: AGENT_SELECT });
  },

  findById(id) {
    return prisma.user.findUnique({ where: { id }, select: AGENT_SELECT });
  },

  update(id, data) {
    return prisma.user.update({ where: { id }, data, select: AGENT_SELECT });
  },

  /**
   * Search across the fields somebody on the phone would actually quote: an
   * agency code, a name, a mobile number.
   */
  list({ query, status, city, isReseller, skip = 0, take = 25 }) {
    const where = {
      role: 'AGENT',
      ...(status ? { status } : {}),
      ...(city ? { city } : {}),
      ...(isReseller === undefined ? {} : { isReseller }),
      ...(query
        ? {
            OR: [
              { agencyCode: { contains: query, mode: 'insensitive' } },
              { agencyName: { contains: query, mode: 'insensitive' } },
              { fullName: { contains: query, mode: 'insensitive' } },
              { username: { contains: query, mode: 'insensitive' } },
              { phone: { contains: query } },
            ],
          }
        : {}),
    };

    return prisma.$transaction([
      prisma.user.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take, select: AGENT_SELECT }),
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
      prisma.havale.count({ where: { ownerId: userId, deletedAt: null } }),
      prisma.havale.count({ where: { ownerId: userId, deletedAt: null, status: 'ACTIVE' } }),
      prisma.contactReveal.count({ where: { viewerId: userId } }),
      prisma.violationReport.count({ where: { reporterId: userId } }),
      prisma.violationReport.count({ where: { havale: { ownerId: userId }, status: 'CONFIRMED' } }),
    ]);
    return { havales, activeHavales, reveals, reportsFiled, reportsAgainst };
  },
};

module.exports = agentRepository;
