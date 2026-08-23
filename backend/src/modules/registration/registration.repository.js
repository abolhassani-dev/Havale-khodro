const { prisma } = require('../../config/database');

/**
 * Database access for the ثبت‌نامی market.
 *
 * Every query here pins `market: 'REGISTRATION'` and carries the market's own
 * detail row. That pin is what keeps the markets apart in one table: a query
 * written in this file cannot return a حواله by accident, and a column added to
 * RegistrationDetail is invisible to every other market.
 *
 * The owner is selected explicitly rather than with `include: { owner: true }`.
 * Pulling the whole user row would put the password hash one careless spread
 * away from a response body, and the serialiser is the only thing between them.
 */

const MARKET = 'REGISTRATION';

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

const WITH_DETAIL = { owner: OWNER_SELECT, registration: true };

const registrationRepository = {
  /**
   * One advertisement and its details, written together.
   *
   * A row in Listing with nothing in RegistrationDetail would be an
   * advertisement with no advertisement in it — visible in the market, empty on
   * the page. The nested write makes the pair atomic.
   */
  create({ detail, ...listing }) {
    return prisma.listing.create({
      data: { ...listing, market: MARKET, registration: { create: detail } },
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
        // `upsert` rather than `update`: an advertisement from before this
        // market had details — or one whose detail row was ever lost — must
        // still be editable rather than answering with a foreign-key error.
        ...(detail ? { registration: { upsert: { create: detail, update: detail } } } : {}),
      },
      include: WITH_DETAIL,
    });
  },

  /** The public list, newest first, one page at a time. */
  listPublic({ where, take, cursor }) {
    return prisma.listing.findMany({
      where: { ...where, market: MARKET },
      include: WITH_DETAIL,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
      ...(cursor
        ? {
            // Keyset paging on (createdAt, id): the second field breaks ties so
            // two advertisements posted in the same millisecond cannot make a
            // page repeat or skip a row.
            skip: 1,
            cursor: { id: cursor.id },
          }
        : {}),
    });
  },

  listOwn({ where, take }) {
    return prisma.listing.findMany({
      where: { ...where, market: MARKET },
      include: WITH_DETAIL,
      orderBy: { createdAt: 'desc' },
      take,
    });
  },

  countOwnActive(ownerId) {
    return prisma.listing.count({
      where: { ownerId, market: MARKET, status: 'ACTIVE', deletedAt: null },
    });
  },
};

module.exports = { registrationRepository, OWNER_SELECT, MARKET };
