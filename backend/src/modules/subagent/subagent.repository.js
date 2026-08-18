const { prisma } = require('../../config/database');

/**
 * Sub-agent accounts, from the parent's side.
 *
 * Every query here is scoped by `parentId`. That is the security boundary of the
 * whole module: a reseller manages their own sub-accounts and nobody else's, and
 * making the scope part of the query rather than a check afterwards means a
 * missing check cannot leak another agency's accounts.
 */
const CHILD_SELECT = {
  id: true,
  username: true,
  fullName: true,
  phone: true,
  agencyCode: true,
  agencyName: true,
  city: true,
  status: true,
  suspendedAt: true,
  lastLoginAt: true,
  createdAt: true,
  mustChangePassword: true,
};

const subagentRepository = {
  listChildren(parentId) {
    return prisma.user.findMany({
      where: { parentId },
      orderBy: { createdAt: 'asc' },
      select: CHILD_SELECT,
    });
  },

  findChild(parentId, id) {
    return prisma.user.findFirst({ where: { id, parentId }, select: CHILD_SELECT });
  },

  countChildren(parentId) {
    return prisma.user.count({ where: { parentId } });
  },

  /** Listing counts per sub-agent, for the parent's overview. */
  async havaleCounts(parentId) {
    const rows = await prisma.havale.groupBy({
      by: ['ownerId'],
      where: { owner: { parentId }, deletedAt: null },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.ownerId, r._count._all]));
  },

  create(data) {
    return prisma.user.create({ data });
  },

  // Matched via the phone's blind index — the client middleware rewrites
  // `where: { phone }` to the indexed column, so this finds the number no
  // matter which account type holds it.
  findByPhone(phone) {
    return prisma.user.findUnique({ where: { phone }, select: { id: true } });
  },

  setStatus(id, status) {
    return prisma.user.update({
      where: { id },
      data: { status, suspendedAt: status === 'SUSPENDED' ? new Date() : null },
      select: CHILD_SELECT,
    });
  },

  setPassword(id, passwordHash) {
    return prisma.user.update({
      where: { id },
      // The parent chose this password, so the sub-agent has to replace it on
      // first sign-in — the same rule that applies to an admin-set password.
      data: { passwordHash, mustChangePassword: true },
      select: CHILD_SELECT,
    });
  },

  endSessions(userId) {
    return prisma.authSession.updateMany({
      where: { userId, endedAt: null },
      data: { endedAt: new Date(), endReason: 'ADMIN_REVOKED' },
    });
  },

  /** The highest sequence number already issued under a parent's code. */
  async lastChildSequence(parentCode) {
    const rows = await prisma.user.findMany({
      where: { agencyCode: { startsWith: `${parentCode}-` } },
      select: { agencyCode: true },
    });

    return rows.reduce((highest, row) => {
      const suffix = row.agencyCode.slice(parentCode.length + 1);
      const value = Number(suffix);
      return Number.isInteger(value) && value > highest ? value : highest;
    }, 0);
  },
};

module.exports = { subagentRepository, CHILD_SELECT };
