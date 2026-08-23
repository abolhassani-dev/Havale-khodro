const listingRepository = require('./listing.repository');
const authRepository = require('../auth/auth.repository');
const { marketOf, allMarkets } = require('../listing/marketRegistry');
const { effectivePermissions } = require('../../constants/roles');
const { HAVALE_STATUS } = require('../../constants/havale');
const { NotFoundError, BadRequestError } = require('../../errors/AppError');

/**
 * Listings, as the people running the system deal with them.
 *
 * The agency side of this is a market: browse, post, renew, reveal. This side
 * is a filing cabinet — find the listing somebody is complaining about, read
 * everything on it, and either hide it or take it down with the reason
 * recorded next to it.
 *
 * One desk, several markets. The shared half of a listing — who posted it, what
 * state it is in, how many people looked — is written out here; the half that
 * only makes sense inside its own market is asked for from that market's
 * descriptor, so a column added to ثبت‌نامی or a market added tomorrow never
 * reaches this file.
 *
 * Nothing here is destructive. «Removing» a listing sets `deletedAt`, which is
 * what the agencies' own queries filter on, and leaves the row for the reveal
 * history and the violation reports that point at it. A row deleted for real
 * would take the evidence with it.
 */

/**
 * A market that never announced itself.
 *
 * Only reachable for a row whose market has no descriptor — a module not
 * loaded, or data from a market that was removed. The row still has to be
 * moderatable, so it degrades to «shared fields only» rather than throwing:
 * the desk's job is to be able to take down anything.
 */
const UNKNOWN_MARKET = { label: 'نامشخص', summarise: () => ({}), describe: () => [] };

const descriptorFor = (row) => marketOf(row.market) || UNKNOWN_MARKET;

function toRow(listing) {
  const market = descriptorFor(listing);
  return {
    id: listing.id,
    serial: listing.serial,
    market: listing.market,
    marketLabel: market.label,
    kind: listing.kind,
    status: listing.status,
    // The two states an administrator actually sorts by, computed once here so
    // the interface never has to work them out from three fields.
    removed: Boolean(listing.deletedAt),
    live: listing.status === HAVALE_STATUS.ACTIVE && !listing.deletedAt,
    carType: listing.carType,
    revealCount: listing.revealCount,
    reportCount: listing.reportCount,
    closesAt: listing.closesAt,
    deletedAt: listing.deletedAt,
    suspendReason: listing.suspendReason,
    createdAt: listing.createdAt,
    // Whatever this market puts on its own row — including the one figure the
    // list column shows, under a name the table does not have to recognise.
    ...(market.summarise ? market.summarise(listing) : {}),
    owner: listing.owner
      ? {
          id: listing.owner.id,
          agencyCode: listing.owner.agencyCode,
          agencyName: listing.owner.agencyName,
          manager: listing.owner.fullName,
          city: listing.owner.city,
          status: listing.owner.status,
          isSubAgent: Boolean(listing.owner.parentId),
        }
      : null,
  };
}

const listingService = {
  /** The markets the panel should offer as sections. */
  markets() {
    return allMarkets();
  },

  async list(filters) {
    const [items, total] = await listingRepository.list(filters);
    // Scoped to the same market as the list: a header counting every market
    // while the table shows one would read as a bug in the table.
    const summary = await listingRepository.summary(filters.market);
    return { items: items.map(toRow), total, summary, market: filters.market || null };
  },

  /**
   * One listing, in full.
   *
   * The owner's contact details are the exception: they are the thing the
   * whole masking design exists to protect, so they are added only for an
   * account whose «مشاهده‌ی گروهی مشخصات» box is ticked — the same permission
   * that governs seeing contact data without spending a reveal anywhere else.
   */
  async detail({ actor, id }) {
    const listing = await listingRepository.findById(id);
    if (!listing) throw new NotFoundError('آگهی');

    const row = toRow(listing);
    const market = descriptorFor(listing);
    const maySeeContact = effectivePermissions(actor).bulkContacts;

    return {
      ...row,
      // The market's own fields, already labelled. The page renders the list it
      // is given instead of naming any market's columns — which is what lets a
      // ثبت‌نامی advertisement and a حواله share one moderation screen.
      fields: market.describe ? market.describe(listing) : [],
      description: listing.description,
      renewedAt: listing.renewedAt,
      renewCount: listing.renewCount,
      updatedAt: listing.updatedAt,
      brand: listing.carModel?.brand?.name || null,
      carModelName: listing.carModel?.name || null,
      reports: listing.reports || [],
      contact: maySeeContact
        ? {
            phone: listing.owner?.phone || null,
            coordinatorName: listing.owner?.coordinatorName || null,
            coordinatorPhone: listing.owner?.coordinatorPhone || null,
          }
        : null,
    };
  },

  /**
   * Hide a listing, or put it back.
   *
   * A reason is required to suspend and is shown to the agency on its own
   * listing — «تعلیق شد» with nothing after it produces a support ticket that
   * this field would have answered.
   */
  async setStatus({ actor, id, status, reason }) {
    const listing = await listingRepository.findById(id);
    if (!listing) throw new NotFoundError('آگهی');
    if (listing.deletedAt) throw new BadRequestError('این آگهی حذف شده است — ابتدا بازگردانی کنید');

    if (status === HAVALE_STATUS.SUSPENDED && !reason) {
      throw new BadRequestError('دلیل تعلیق را بنویسید — نماینده همین متن را می‌بیند');
    }

    const updated = await listingRepository.update(id, {
      status,
      suspendReason: status === HAVALE_STATUS.SUSPENDED ? reason : null,
    });

    await authRepository.recordActivity({
      userId: actor.id,
      // The action strings are unchanged on purpose: the whole existing history
      // is written under them, and the timeline reads them for every market.
      action: status === HAVALE_STATUS.SUSPENDED ? 'HAVALE_SUSPENDED_BY_ADMIN' : 'HAVALE_RESTORED_BY_ADMIN',
      targetType: listing.market || 'LISTING',
      targetId: id,
      summary: status === HAVALE_STATUS.SUSPENDED ? reason : listing.carType,
    });

    return toRow(updated);
  },

  /** Take a listing down, or undo that. The row stays either way. */
  async setRemoved({ actor, id, removed, reason }) {
    const listing = await listingRepository.findById(id);
    if (!listing) throw new NotFoundError('آگهی');

    if (removed && !reason) {
      throw new BadRequestError('دلیل حذف را بنویسید — در سابقه‌ی سامانه ثبت می‌شود');
    }

    const updated = await listingRepository.update(id, {
      deletedAt: removed ? new Date() : null,
      // Restoring must not leave a listing hidden by a reason nobody can see
      // any more: what comes back is an ordinary active listing.
      ...(removed ? {} : { status: HAVALE_STATUS.ACTIVE, suspendReason: null }),
    });

    await authRepository.recordActivity({
      userId: actor.id,
      action: removed ? 'HAVALE_REMOVED_BY_ADMIN' : 'HAVALE_RESTORED_BY_ADMIN',
      targetType: listing.market || 'LISTING',
      targetId: id,
      summary: removed ? reason : listing.carType,
    });

    return toRow(updated);
  },
};

module.exports = listingService;
