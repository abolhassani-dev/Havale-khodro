const { prisma } = require('../../config/database');
const authRepository = require('../auth/auth.repository');
const { startOfTehranDay } = require('../../utils/time');
const { MESSAGES } = require('../../constants/messages');
const { ERROR_CODES } = require('../../constants/errorCodes');
const { NotFoundError, BadRequestError, ForbiddenError } = require('../../errors/AppError');

/**
 * Showing a contact, and what it costs — for every market at once.
 *
 * This is the rule the business runs on: a listing's contact details are hidden
 * until somebody spends one of their allowance, and the spend is recorded with
 * the number exactly as it read at that moment. It lives here, once, because a
 * second copy of it in another market's module is not a copy — it is a second
 * rule, and the day they drift is the day one market gives contacts away.
 *
 * The allowance is shared across markets on purpose (the agency bought one
 * subscription, not one per market), which falls out of counting rows in
 * ContactReveal without looking at which market they belong to.
 */

// Everything the reveal needs about the owner. Kept here rather than imported
// from a market's module: the kernel must not depend on the markets.
const OWNER_SELECT = {
  select: {
    id: true,
    status: true,
    agencyCode: true,
    agencyName: true,
    city: true,
    fullName: true,
    phone: true,
    coordinatorName: true,
    coordinatorPhone: true,
  },
};

const revealRepository = {
  findListing(id) {
    return prisma.listing.findFirst({
      where: { id, deletedAt: null },
      include: { owner: OWNER_SELECT },
    });
  },

  findReveal(listingId, viewerId) {
    return prisma.contactReveal.findUnique({
      where: { listingId_viewerId: { listingId, viewerId } },
    });
  },

  /** Which of these listings this viewer has already opened. */
  async revealedIds(listingIds, viewerId) {
    if (!listingIds.length) return new Set();
    const rows = await prisma.contactReveal.findMany({
      where: { viewerId, listingId: { in: listingIds } },
      select: { listingId: true },
    });
    return new Set(rows.map((r) => r.listingId));
  },

  countSince(viewerId, since) {
    return prisma.contactReveal.count({ where: { viewerId, createdAt: { gte: since } } });
  },

  /**
   * Records the reveal and bumps the owner's visible counter in one transaction.
   *
   * If the two could come apart, a failure between them would either charge the
   * viewer for nothing or show the owner a view that was never recorded — and
   * the recorded trail is the evidence the whole monitoring feature rests on.
   */
  record({ listingId, viewerId, ip, phoneShown, agencyCodeShown }) {
    return prisma.$transaction([
      prisma.contactReveal.create({
        data: { listingId, viewerId, ip, phoneShown, agencyCodeShown },
      }),
      prisma.listing.update({ where: { id: listingId }, data: { revealCount: { increment: 1 } } }),
    ]);
  },
};

/** What the caller hands back to the viewer once the reveal is paid for. */
function toRevealResult(owner, usage) {
  return {
    contact: {
      coordinatorName: owner.coordinatorName,
      coordinatorPhone: owner.coordinatorPhone,
      phone: owner.phone,
    },
    agency: { code: owner.agencyCode, name: owner.agencyName, city: owner.city },
    usage,
  };
}

/**
 * How much of the allowance is gone.
 *
 * The day is a calendar day in Tehran; the month is this subscription's
 * thirty-day period rather than a Jalali month, so renewing early cannot be
 * used to reset the allowance (review round 3, fix 2).
 */
async function usageFor({ user, access }) {
  const [dailyUsed, monthlyUsed] = await Promise.all([
    revealRepository.countSince(user.id, startOfTehranDay()),
    access.periodStart ? revealRepository.countSince(user.id, access.periodStart) : Promise.resolve(0),
  ]);

  return {
    dailyUsed,
    dailyLimit: access.dailyLimit,
    monthlyUsed,
    monthlyLimit: access.monthlyLimit,
  };
}

/**
 * Spend one view on a listing's contact details.
 *
 * @param {object} args
 * @param {object} args.user        the viewer
 * @param {object} args.access      the entitlement, from the access table
 * @param {string} args.id          the listing
 * @param {string} [args.ip]
 * @param {string} [args.notFound]  what to call the thing when it is not there
 * @param {string} [args.targetType] how the activity log names it
 */
async function reveal({ user, access, id, ip, notFound = 'آگهی', targetType = 'LISTING' }) {
  const listing = await revealRepository.findListing(id);
  if (!listing) throw new NotFoundError(notFound);

  if (listing.ownerId === user.id) {
    throw new BadRequestError(MESSAGES.HAVALE.OWN_CONTACT);
  }

  // A suspended agency's listings are not in the market, and paying to reach
  // one would be paying for a number nobody will answer.
  if (listing.owner.status !== 'ACTIVE') throw new NotFoundError(notFound);

  // Already opened: hand it back without charging again. The unique constraint
  // on (listing, viewer) makes that the natural behaviour rather than something
  // to remember — an agent who closes the tab has not used up a second view.
  const existing = await revealRepository.findReveal(id, user.id);
  if (existing) {
    return toRevealResult(listing.owner, await usageFor({ user, access }));
  }

  const usage = await usageFor({ user, access });

  if (usage.dailyUsed >= usage.dailyLimit) {
    throw new ForbiddenError(MESSAGES.HAVALE.DAILY_LIMIT, ERROR_CODES.REVEAL_LIMIT_REACHED);
  }
  if (usage.monthlyUsed >= usage.monthlyLimit) {
    throw new ForbiddenError(MESSAGES.HAVALE.MONTHLY_LIMIT, ERROR_CODES.REVEAL_LIMIT_REACHED);
  }

  await revealRepository.record({
    listingId: id,
    viewerId: user.id,
    ip,
    // The number as it read at this moment. Contact details can be changed
    // later through a ticket, and without this the log would quietly rewrite
    // history to show the new number (review round 3, fix 6).
    phoneShown: listing.owner.coordinatorPhone,
    agencyCodeShown: listing.owner.agencyCode,
  });

  await authRepository.recordActivity({
    userId: user.id,
    action: 'CONTACT_REVEALED',
    targetType,
    targetId: id,
    summary: listing.owner.agencyCode,
    ip,
  });

  return toRevealResult(listing.owner, {
    ...usage,
    dailyUsed: usage.dailyUsed + 1,
    monthlyUsed: usage.monthlyUsed + 1,
  });
}

/**
 * Advertisements this agency paid to see, which have been changed since.
 *
 * A reveal is a purchase: one of the day's allowance, spent on a particular set
 * of numbers. If the advertisement is edited afterwards, what they bought is no
 * longer what is on the page — and they would have no way of knowing, because
 * an edited row looks exactly like an untouched one. So they are told.
 *
 * The comparison is done here rather than in the query because it is between
 * two columns in two tables — `Listing.editedAt` against `ContactReveal
 * .createdAt` — and the candidate set is small: the daily allowance bounds how
 * many reveals anybody has.
 */
async function editedSinceRevealFor(viewerId, since) {
  const rows = await prisma.contactReveal.findMany({
    where: {
      viewerId,
      listing: { editedAt: since ? { gt: since } : { not: null } },
    },
    select: {
      createdAt: true,
      listing: {
        select: {
          id: true,
          serial: true,
          carType: true,
          market: true,
          editedAt: true,
          editCount: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  return rows.filter((row) => row.listing.editedAt > row.createdAt);
}

module.exports = {
  reveal,
  usageFor,
  toRevealResult,
  editedSinceRevealFor,
  revealRepository,
  OWNER_SELECT,
};
