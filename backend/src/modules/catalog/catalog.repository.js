const { prisma } = require('../../config/database');

const catalogRepository = {
  /** The whole tree, active entries only, in display order. */
  listCompanies() {
    return prisma.carCompany.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        slug: true,
        brands: {
          where: { isActive: true },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          select: {
            id: true,
            name: true,
            slug: true,
            models: {
              where: { isActive: true },
              orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
              select: { id: true, name: true },
            },
          },
        },
      },
    });
  },

  listColors() {
    return prisma.carColor.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true },
    });
  },

  /**
   * A model with its brand and company, for writing the snapshot onto a listing.
   * Inactive models are excluded: retiring a model must stop new listings using
   * it, while leaving the ones already posted intact.
   */
  findModel(id) {
    return prisma.carModel.findFirst({
      where: { id, isActive: true },
      select: {
        id: true,
        name: true,
        brand: { select: { id: true, name: true, company: { select: { name: true } } } },
      },
    });
  },

  findColorByName(name) {
    return prisma.carColor.findFirst({ where: { name, isActive: true } });
  },
};

module.exports = catalogRepository;
