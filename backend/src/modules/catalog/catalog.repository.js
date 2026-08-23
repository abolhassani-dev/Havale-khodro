const { prisma } = require('../../config/database');

const catalogRepository = {
  /**
   * The whole tree, active entries only, in display order.
   *
   * Rooted at the brand, not at the company. The tree used to hang off the
   * company, which stopped working the moment a brand was allowed to have none
   * — and most of them have none, because the market list this is built from
   * has no manufacturer level and guessing one would be worse than leaving it
   * blank. A company-rooted tree would simply have omitted every ungrouped
   * brand, and the listing form would have offered nothing.
   *
   * The company survives as a label on the brand: useful for grouping the
   * picker, never required for anything to work.
   */
  listBrands() {
    // Brands only — the 2044 models used to ride along and made this the
    // heaviest response in the product, fetched by the search page and both
    // listing forms on every visit. One brand's models are a request of their
    // own (`listActiveModelsOfBrand`), made when a brand is actually chosen.
    return prisma.carBrand.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        slug: true,
        logo: true,
        company: { select: { id: true, name: true } },
        _count: { select: { models: { where: { isActive: true } } } },
      },
    });
  },

  /** One brand's postable models, for the forms and the picker. */
  listActiveModelsOfBrand(brandId) {
    return prisma.carModel.findMany({
      where: { brandId, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true },
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
      select: { id: true, name: true, slug: true, isActive: true, sortOrder: true },
    });
  },

  /**
   * Every brand with a count of its models, and no models.
   *
   * The count, not the rows. This screen used to send the entire catalogue in
   * one response — every model of every brand — which was fine for the twenty-six
   * models it started with and is not fine for two thousand. The models of one
   * brand are fetched when somebody opens that brand, which is the only time
   * anybody looks at them.
   */
  listAllBrands() {
    return prisma.carBrand.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        slug: true,
        logo: true,
        isActive: true,
        sortOrder: true,
        companyId: true,
        _count: { select: { models: true } },
      },
    });
  },

  listModelsOfBrand(brandId) {
    return prisma.carModel.findMany({
      where: { brandId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, isActive: true, sortOrder: true },
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
    return prisma.listing.count({ where: { carModelId: modelId } });
  },
};

module.exports = catalogRepository;
