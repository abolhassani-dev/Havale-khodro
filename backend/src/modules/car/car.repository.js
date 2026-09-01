const { prisma } = require('../../config/database');

/**
 * Database access for the خودرو market.
 *
 * Every query pins `market: 'CAR'` and carries this market's own detail row
 * and photos. The pin is what keeps the markets apart in one table: a query
 * written here cannot return a حواله by accident, and a column added to
 * CarDetail is invisible to every other market.
 */

const MARKET = 'CAR';

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
    parentId: true,
  },
};

const WITH_DETAIL = {
  owner: OWNER_SELECT,
  car: true,
  carPhotos: { orderBy: { sortOrder: 'asc' } },
};

const carRepository = {
  /** One advertisement and its details, written together — atomically. */
  create({ detail, ...listing }) {
    return prisma.listing.create({
      data: { ...listing, market: MARKET, car: { create: detail } },
      include: WITH_DETAIL,
    });
  },

  findById(id) {
    return prisma.listing.findFirst({
      where: { id, market: MARKET, deletedAt: null },
      include: WITH_DETAIL,
    });
  },

  update(id, { detail, ...listing }) {
    return prisma.listing.update({
      where: { id },
      data: {
        ...listing,
        // Plain nested update, not the upsert its siblings use: every row in
        // this market is born with its detail (the create is atomic), and an
        // upsert's create-branch would demand the required bodyType on every
        // edit that never touches it.
        ...(detail ? { car: { update: detail } } : {}),
      },
      include: WITH_DETAIL,
    });
  },

  /**
   * The public list, numbered pages only — no cursor need yet.
   *
   * The order comes from the caller (see orderFor in the service) because in
   * this market it is a product choice — price, mileage, newest — not a fact
   * about the table. Newest first when nobody says otherwise.
   */
  listPublic({ where, take, skip = 0, orderBy }) {
    return prisma.listing.findMany({
      where: { ...where, market: MARKET },
      include: WITH_DETAIL,
      orderBy: orderBy || [{ createdAt: 'desc' }, { id: 'desc' }],
      skip,
      take,
    });
  },

  listOwn({ where, take, skip = 0 }) {
    return prisma.listing.findMany({
      where: { ...where, market: MARKET },
      include: WITH_DETAIL,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });
  },

  /** Always scoped to this market — the pin is added here, never trusted. */
  count(where) {
    return prisma.listing.count({ where: { ...where, market: MARKET } });
  },

  // ── photos ──────────────────────────────────────────────────────────────

  addPhotos(rows) {
    return prisma.carPhoto.createMany({ data: rows });
  },

  findPhotoById(id) {
    return prisma.carPhoto.findUnique({
      where: { id },
      include: { listing: { select: { id: true, ownerId: true, deletedAt: true } } },
    });
  },

  findPhoto(fileName) {
    return prisma.carPhoto.findUnique({
      where: { fileName },
      include: { listing: { select: { id: true, ownerId: true, market: true, deletedAt: true } } },
    });
  },

  countPhotos(listingId) {
    return prisma.carPhoto.count({ where: { listingId } });
  },

  deletePhoto(id) {
    return prisma.carPhoto.delete({ where: { id } });
  },
};

module.exports = { carRepository, OWNER_SELECT, MARKET };
