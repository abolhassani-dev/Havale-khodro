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

  // ── editing, from the admin panel ─────────────────────────────────────────
  //
  // There is deliberately no delete anywhere below. A model that has been used
  // is referenced by listings, reveal records and violation reports; removing it
  // would take history with it. Deactivating stops new listings and leaves the
  // old ones readable, which is what "removing a car" actually needs to mean.

  listAllCompanies() {
    return prisma.carCompany.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        brands: {
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          include: {
            models: { orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] },
            _count: { select: { models: true } },
          },
        },
      },
    });
  },

  listAllColors() {
    return prisma.carColor.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
  },

  createCompany(data) {
    return prisma.carCompany.create({ data });
  },

  updateCompany(id, data) {
    return prisma.carCompany.update({ where: { id }, data });
  },

  createBrand(data) {
    return prisma.carBrand.create({ data });
  },

  updateBrand(id, data) {
    return prisma.carBrand.update({ where: { id }, data });
  },

  createModel(data) {
    return prisma.carModel.create({ data });
  },

  updateModel(id, data) {
    return prisma.carModel.update({ where: { id }, data });
  },

  createColor(data) {
    return prisma.carColor.create({ data });
  },

  updateColor(id, data) {
    return prisma.carColor.update({ where: { id }, data });
  },

  findBrand(id) {
    return prisma.carBrand.findUnique({ where: { id } });
  },

  findCompany(id) {
    return prisma.carCompany.findUnique({ where: { id } });
  },

  /** How many listings already point at a model — shown before deactivating it. */
  countHavalesForModel(modelId) {
    return prisma.havale.count({ where: { carModelId: modelId } });
  },
};

module.exports = catalogRepository;
