const { prisma } = require('../../config/database');

/**
 * Database access for listings and contact reveals.
 *
 * The owner is always selected explicitly rather than with `include: { owner:
 * true }`. Pulling the whole user row would put the password hash and every
 * private column one careless spread away from a response body, and the DTO is
 * the only thing standing between the two.
 */
const OWNER_SELECT = {
  select: {
    id: true,
    agencyName: true,
    agencyCode: true,
    city: true,
    coordinatorName: true,
    coordinatorPhone: true,
    phone: true,
    status: true,
  },
};

const havaleRepository = {
  create(data) {
    return prisma.havale.create({ data, include: { owner: OWNER_SELECT } });
  },

  findById(id) {
    return prisma.havale.findFirst({
      where: { id, deletedAt: null },
      include: { owner: OWNER_SELECT },
    });
  },

  /** Includes soft-deleted rows — for the admin panel and violation history. */
  findByIdIncludingDeleted(id) {
    return prisma.havale.findUnique({ where: { id }, include: { owner: OWNER_SELECT } });
  },

  update(id, data) {
    return prisma.havale.update({ where: { id }, data, include: { owner: OWNER_SELECT } });
  },

  /**
   * Keyset pagination.
   *
   * Offset pagination re-scans and discards every row before the offset, so page
   * 500 of a busy list costs five hundred times page one. Seeking from the last
   * row of the previous page costs the same at any depth — which is the
   * difference that shows up when ten thousand agents are browsing at once.
   */
  list({ where, cursor, take, skip }) {
    return prisma.havale.findMany({
      where: cursor
        ? {
            AND: [
              where,
              {
                OR: [
                  { createdAt: { lt: cursor.createdAt } },
                  { createdAt: cursor.createdAt, id: { lt: cursor.id } },
                ],
              },
            ],
          }
        : where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      // skip serves the numbered pager the panel shows people; cursor serves
      // depth-proof scanning. The two are never combined: a numbered page is
      // an absolute position, a cursor is a relative one.
      skip: cursor ? undefined : skip,
      take,
      include: { owner: OWNER_SELECT },
    });
  },

  count(where) {
    return prisma.havale.count({ where });
  },

  /** The accounts of one network: the main agency and every sub-agency under it. */
  async networkMemberIds(rootId) {
    const rows = await prisma.user.findMany({
      where: { OR: [{ id: rootId }, { parentId: rootId }] },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  },

  findReveal(havaleId, viewerId) {
    return prisma.contactReveal.findUnique({
      where: { havaleId_viewerId: { havaleId, viewerId } },
    });
  },

  /** Which of these listings this viewer has already opened. */
  async findRevealedIds(havaleIds, viewerId) {
    if (!havaleIds.length) return new Set();
    const rows = await prisma.contactReveal.findMany({
      where: { viewerId, havaleId: { in: havaleIds } },
      select: { havaleId: true },
    });
    return new Set(rows.map((r) => r.havaleId));
  },

  countRevealsSince(viewerId, since) {
    return prisma.contactReveal.count({ where: { viewerId, createdAt: { gte: since } } });
  },

  /**
   * Records the reveal and bumps the owner's visible counter in one transaction.
   *
   * If the two could come apart, a failure between them would either charge the
   * viewer for nothing or show the owner a view that was never recorded — and
   * the recorded trail is the evidence the whole monitoring feature rests on.
   */
  createReveal({ havaleId, viewerId, ip, phoneShown, agencyCodeShown }) {
    return prisma.$transaction([
      prisma.contactReveal.create({
        data: { havaleId, viewerId, ip, phoneShown, agencyCodeShown },
      }),
      prisma.havale.update({ where: { id: havaleId }, data: { revealCount: { increment: 1 } } }),
    ]);
  },
};

module.exports = { havaleRepository, OWNER_SELECT };
