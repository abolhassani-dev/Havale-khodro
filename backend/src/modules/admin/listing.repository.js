const { prisma } = require('../../config/database');

/**
 * Listings, from the admin side.
 *
 * The agent-facing repository hides three things that this one must show:
 * suspended listings, soft-deleted ones, and whose they are. That is the whole
 * reason this exists as its own file — a flag on the other one would be a
 * switch between «what an agency may see» and «everything», sitting inside the
 * code path that serves agencies.
 */

// The owner rides along on every row: an administrator looking at a listing is
// almost always asking «whose is this?» next.
const OWNER_SELECT = {
  id: true,
  agencyCode: true,
  agencyName: true,
  fullName: true,
  city: true,
  status: true,
  parentId: true,
};

const LIST_SELECT = {
  id: true,
  serial: true,
  kind: true,
  status: true,
  carType: true,
  carColor: true,
  model: true,
  solh: true,
  amountToman: true,
  carPriceToman: true,
  deliveryDays: true,
  supplierCompany: true,
  revealCount: true,
  reportCount: true,
  closesAt: true,
  deletedAt: true,
  suspendReason: true,
  createdAt: true,
  owner: { select: OWNER_SELECT },
};

/**
 * What the text box searches.
 *
 * The fields somebody would actually quote down the phone: a serial, a car, a
 * colour, the supplying company, or the agency's name and code. Not the
 * description — a substring of free text matches half the table and makes the
 * search feel broken rather than broad.
 */
function textFilter(query) {
  // Guarded before the cast: `String(undefined)` is the word «undefined», and
  // searching for that matches nothing — which reads as an empty database
  // rather than as a bug, on every request that does not search.
  if (query === undefined || query === null) return null;

  const text = String(query).trim();
  if (!text) return null;

  const like = { contains: text, mode: 'insensitive' };
  const or = [
    { carType: like },
    { carColor: like },
    { model: like },
    { supplierCompany: like },
    { owner: { agencyName: like } },
    { owner: { agencyCode: like } },
    { owner: { city: like } },
  ];

  // A bare number is a serial. Kept as an extra branch rather than a separate
  // mode, because «۱۲» is a perfectly good thing to type into one box.
  const serial = Number(text.replace(/[^\d]/g, ''));
  if (serial > 0 && serial < 2 ** 31) or.push({ serial });

  return { OR: or };
}

/**
 * Status, including the two that are not statuses.
 *
 * `DELETED` and `LIVE` are how somebody thinks about this list, not columns:
 * a removed listing keeps its old status and carries a `deletedAt`, and «live»
 * means active and not removed. Translating here keeps that vocabulary out of
 * every caller.
 */
function statusFilter(status) {
  if (!status || status === 'ALL') return {};
  if (status === 'DELETED') return { deletedAt: { not: null } };
  if (status === 'LIVE') return { status: 'ACTIVE', deletedAt: null };
  return { status, deletedAt: null };
}

const listingRepository = {
  list({ query, kind, status, ownerId, skip = 0, take = 25 }) {
    const where = {
      ...(kind ? { kind } : {}),
      ...(ownerId ? { ownerId } : {}),
      ...statusFilter(status),
      ...(textFilter(query) || {}),
    };

    return Promise.all([
      prisma.listing.findMany({
        where,
        select: LIST_SELECT,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.listing.count({ where }),
    ]);
  },

  findById(id) {
    return prisma.listing.findUnique({
      where: { id },
      select: {
        ...LIST_SELECT,
        paidAmountToman: true,
        paymentType: true,
        depositDays: true,
        description: true,
        renewedAt: true,
        renewCount: true,
        updatedAt: true,
        carModel: { select: { id: true, name: true, brand: { select: { id: true, name: true } } } },
        // The owner's contact, decrypted by the middleware, is added by the
        // service and only for an account allowed to see contact details.
        owner: { select: { ...OWNER_SELECT, phone: true, coordinatorName: true, coordinatorPhone: true } },
        reports: {
          select: { id: true, reason: true, status: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });
  },

  update(id, data) {
    return prisma.listing.update({ where: { id }, data, select: LIST_SELECT });
  },

  /** The counts the page header shows, in one round trip rather than four. */
  async summary() {
    const [live, suspended, deleted, total] = await Promise.all([
      prisma.listing.count({ where: { status: 'ACTIVE', deletedAt: null } }),
      prisma.listing.count({ where: { status: 'SUSPENDED', deletedAt: null } }),
      prisma.listing.count({ where: { deletedAt: { not: null } } }),
      prisma.listing.count(),
    ]);
    return { live, suspended, deleted, total };
  },
};

module.exports = listingRepository;
