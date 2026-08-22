const listingRepository = require('./listing.repository');
const authRepository = require('../auth/auth.repository');
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
 * Nothing here is destructive. «Removing» a listing sets `deletedAt`, which is
 * what the agencies' own queries filter on, and leaves the row for the reveal
 * history and the violation reports that point at it. A row deleted for real
 * would take the evidence with it.
 */

/** Money arrives from Prisma as BigInt, and JSON.stringify throws on those. */
const toNumber = (value) => (value === null || value === undefined ? null : Number(value));

function toRow(havale) {
  return {
    id: havale.id,
    serial: havale.serial,
    kind: havale.kind,
    status: havale.status,
    // The two states an administrator actually sorts by, computed once here so
    // the interface never has to work them out from three fields.
    removed: Boolean(havale.deletedAt),
    live: havale.status === HAVALE_STATUS.ACTIVE && !havale.deletedAt,
    carType: havale.carType,
    carColor: havale.carColor,
    model: havale.model,
    solh: havale.solh,
    amountToman: toNumber(havale.amountToman),
    carPriceToman: toNumber(havale.carPriceToman),
    deliveryDays: havale.deliveryDays,
    supplierCompany: havale.supplierCompany,
    revealCount: havale.revealCount,
    reportCount: havale.reportCount,
    closesAt: havale.closesAt,
    deletedAt: havale.deletedAt,
    suspendReason: havale.suspendReason,
    createdAt: havale.createdAt,
    owner: havale.owner
      ? {
          id: havale.owner.id,
          agencyCode: havale.owner.agencyCode,
          agencyName: havale.owner.agencyName,
          manager: havale.owner.fullName,
          city: havale.owner.city,
          status: havale.owner.status,
          isSubAgent: Boolean(havale.owner.parentId),
        }
      : null,
  };
}

const listingService = {
  async list(filters) {
    const [items, total] = await listingRepository.list(filters);
    const summary = await listingRepository.summary();
    return { items: items.map(toRow), total, summary };
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
    const havale = await listingRepository.findById(id);
    if (!havale) throw new NotFoundError('حواله');

    const row = toRow(havale);
    const maySeeContact = effectivePermissions(actor).bulkContacts;

    return {
      ...row,
      paidAmountToman: toNumber(havale.paidAmountToman),
      paymentType: havale.paymentType,
      depositDays: havale.depositDays,
      description: havale.description,
      renewedAt: havale.renewedAt,
      renewCount: havale.renewCount,
      updatedAt: havale.updatedAt,
      brand: havale.carModel?.brand?.name || null,
      carModelName: havale.carModel?.name || null,
      reports: havale.reports || [],
      contact: maySeeContact
        ? {
            phone: havale.owner?.phone || null,
            coordinatorName: havale.owner?.coordinatorName || null,
            coordinatorPhone: havale.owner?.coordinatorPhone || null,
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
    const havale = await listingRepository.findById(id);
    if (!havale) throw new NotFoundError('حواله');
    if (havale.deletedAt) throw new BadRequestError('این حواله حذف شده است — ابتدا بازگردانی کنید');

    if (status === HAVALE_STATUS.SUSPENDED && !reason) {
      throw new BadRequestError('دلیل تعلیق را بنویسید — نماینده همین متن را می‌بیند');
    }

    const updated = await listingRepository.update(id, {
      status,
      suspendReason: status === HAVALE_STATUS.SUSPENDED ? reason : null,
    });

    await authRepository.recordActivity({
      userId: actor.id,
      action: status === HAVALE_STATUS.SUSPENDED ? 'HAVALE_SUSPENDED_BY_ADMIN' : 'HAVALE_RESTORED_BY_ADMIN',
      targetType: 'HAVALE',
      targetId: id,
      summary: status === HAVALE_STATUS.SUSPENDED ? reason : havale.carType,
    });

    return toRow(updated);
  },

  /** Take a listing down, or undo that. The row stays either way. */
  async setRemoved({ actor, id, removed, reason }) {
    const havale = await listingRepository.findById(id);
    if (!havale) throw new NotFoundError('حواله');

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
      targetType: 'HAVALE',
      targetId: id,
      summary: removed ? reason : havale.carType,
    });

    return toRow(updated);
  },
};

module.exports = listingService;
