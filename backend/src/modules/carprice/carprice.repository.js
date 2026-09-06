const { prisma } = require('../../config/database');

/** All database access for the price snapshot — the service decides, this writes. */
const carPriceRepository = {
  startRun(group) {
    return prisma.carPriceRun.create({ data: { group } });
  },

  finishRun(id, data) {
    return prisma.carPriceRun.update({
      where: { id },
      data: { ...data, finishedAt: new Date() },
    });
  },

  /** The latest successful run of one group, for the sanity gate and the stamp. */
  lastOkRun(group) {
    return prisma.carPriceRun.findFirst({
      where: { group, ok: true },
      orderBy: { finishedAt: 'desc' },
    });
  },

  itemsByIds(ids) {
    return prisma.carPriceItem.findMany({ where: { id: { in: ids } } });
  },

  /** Ids of the items that already have a history point since `since`. */
  async itemsWithHistorySince(ids, since) {
    const rows = await prisma.carPriceHistory.findMany({
      where: { itemId: { in: ids }, at: { gte: since } },
      select: { itemId: true },
      distinct: ['itemId'],
    });
    return new Set(rows.map((r) => r.itemId));
  },

  /**
   * The whole snapshot in one transaction: every item upserted, the history
   * points appended, the run stamped ok. Either all of it lands or none of
   * it does — a half-written list is exactly the thing the gate exists to
   * prevent, and a crash mid-way must not produce one either.
   */
  writeSnapshot({ runId, items, history, secondLabel, sourceStamp, changed }) {
    return prisma.$transaction([
      ...items.map((item) =>
        prisma.carPriceItem.upsert({
          where: { id: item.id },
          create: item,
          update: item,
        })
      ),
      ...(history.length ? [prisma.carPriceHistory.createMany({ data: history })] : []),
      prisma.carPriceRun.update({
        where: { id: runId },
        data: { ok: true, finishedAt: new Date(), itemCount: items.length, changed, secondLabel, sourceStamp },
      }),
    ]);
  },

  /** Items still in the feed, in the source's order. */
  listSeenSince(since) {
    return prisma.carPriceItem.findMany({
      where: { seenAt: { gte: since } },
      orderBy: [{ group: 'asc' }, { sortOrder: 'asc' }],
    });
  },

  watchIds(ownerId) {
    return prisma.carPriceWatch.findMany({ where: { ownerId }, select: { itemId: true } });
  },

  watchCount(ownerId) {
    return prisma.carPriceWatch.count({ where: { ownerId } });
  },

  addWatch(ownerId, itemId) {
    return prisma.carPriceWatch.upsert({
      where: { ownerId_itemId: { ownerId, itemId } },
      create: { ownerId, itemId },
      update: {},
    });
  },

  removeWatch(ownerId, itemId) {
    return prisma.carPriceWatch.deleteMany({ where: { ownerId, itemId } });
  },

  itemExists(id) {
    return prisma.carPriceItem.findUnique({ where: { id }, select: { id: true } });
  },

  pruneHistoryBefore(before) {
    return prisma.carPriceHistory.deleteMany({ where: { at: { lt: before } } });
  },
};

module.exports = carPriceRepository;
