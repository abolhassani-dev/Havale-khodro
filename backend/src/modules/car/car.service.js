const { carRepository } = require('./car.repository');
const { toCard, toOwn } = require('./car.dto');
const { LIFETIME_DAYS, deriveGrade, bodyStatusError } = require('./car.constants');
const revealService = require('../listing/reveal.service');
const catalogRepository = require('../catalog/catalog.repository');
const authRepository = require('../auth/auth.repository');
const { addDays } = require('../../utils/time');
const { diffOf } = require('../../utils/diff');
const { assertClean } = require('../../utils/textGuard');
const { LIST_PAGE_SIZE, MAX_PAGE } = require('../../constants/havale');
const { MESSAGES } = require('../../constants/messages');
const { NotFoundError, BadRequestError, ValidationError } = require('../../errors/AppError');

/**
 * The خودرو market: a finished car — zero-kilometre or used — offered or
 * sought between agencies.
 *
 * Two decisions distinguish it from its siblings and both were the owner's:
 *
 * 1. There is no brand restriction here, on either side. The حواله market
 *    limits which brands an agency may *offer* because a حواله is a factory
 *    allocation; a finished car on the lot is anybody's to sell. So this
 *    module never consults brandAccess, and the full catalogue is postable.
 *
 * 2. The body table is public and the photographs are not. A chip matrix has
 *    nowhere to hide a telephone number; a windshield does. So the structured
 *    body goes on the card, and the photos ride behind the reveal with the
 *    description.
 *
 * Everything shared — reveal pricing, reports, notices, moderation — comes
 * from the kernel. What lives here is what makes this market itself.
 */

const NOT_FOUND = 'آگهی خودرو';

/** Splits a payload into the shared listing columns and this market's own. */
function split(payload, bodyType) {
  const {
    kind,
    carModelId,
    description,
    year,
    yearFrom,
    yearTo,
    mileageKm,
    maxMileageKm,
    carColor,
    carPriceToman,
    priceFromToman,
    bodyStatus,
    paintTolerance,
  } = payload;

  return {
    listing: {
      kind,
      carModelId,
      description,
      carColor: carColor || null,
      carPriceToman:
        carPriceToman === undefined || carPriceToman === null ? null : BigInt(carPriceToman),
    },
    detail: {
      ...(bodyType ? { bodyType } : {}),
      year: year ?? null,
      yearFrom: yearFrom ?? null,
      yearTo: yearTo ?? null,
      mileageKm: mileageKm ?? null,
      maxMileageKm: maxMileageKm ?? null,
      priceFromToman:
        priceFromToman === undefined || priceFromToman === null ? null : BigInt(priceFromToman),
      ...(bodyStatus !== undefined
        ? { bodyStatus: bodyStatus || {}, bodyGrade: deriveGrade(bodyStatus) }
        : {}),
      ...(paintTolerance !== undefined ? { paintTolerance } : {}),
    },
  };
}

/**
 * The fields an edit is worth recording, and what to call them in the log.
 */
const LISTING_FIELDS = {
  description: ['توضیحات'],
  carColor: ['رنگ بدنه'],
  carPriceToman: ['قیمت خودرو', 'money'],
};

const DETAIL_FIELDS = {
  year: ['سال ساخت', 'number'],
  yearFrom: ['سال ساخت از', 'number'],
  yearTo: ['سال ساخت تا', 'number'],
  mileageKm: ['کارکرد', 'number'],
  maxMileageKm: ['حداکثر کارکرد', 'number'],
  priceFromToman: ['قیمت از', 'money'],
  paintTolerance: ['وضعیت قابل قبول'],
};

function detailPatch(payload) {
  const { detail } = split(payload);
  const out = {};
  for (const key of Object.keys(detail)) {
    if (payload[key] !== undefined) out[key] = detail[key];
  }
  // Re-deriving the grade travels with the table it derives from.
  if (payload.bodyStatus !== undefined) {
    out.bodyStatus = payload.bodyStatus || {};
    out.bodyGrade = deriveGrade(payload.bodyStatus);
  }
  return Object.keys(out).length ? out : null;
}

/**
 * One typed box on this market — everything else is chips, numbers and
 * catalogue words. The photos are the other free channel, and they are
 * handled by being gated, not by being scanned.
 */
function freeText(payload) {
  return { توضیحات: payload.description };
}

function identity(user) {
  return { agencyCode: user.agencyCode, agencyName: user.agencyName };
}

/**
 * The deep body-table check, service-side on purpose: Joi with stripUnknown
 * would silently drop a mis-keyed part, and a قطعه that vanishes without a
 * word is worse than a refusal (see car.validator.js).
 */
function assertBody(bodyStatus) {
  const problem = bodyStatusError(bodyStatus);
  if (problem) throw new ValidationError(problem);
}

const carService = {
  async create({ user, payload }) {
    assertClean(freeText(payload), identity(user));
    assertBody(payload.bodyStatus);

    // The car's name — and in this market its body shape — are copied onto
    // the row rather than only referenced: an advertisement keeps saying what
    // it said when it was posted, and its cut-out map must not break if the
    // catalogue row is renamed or retired next season.
    const model = await catalogRepository.findModel(payload.carModelId);
    if (!model) throw new BadRequestError(MESSAGES.HAVALE.UNKNOWN_MODEL);

    const { listing, detail } = split(payload, model.bodyType || 'SEDAN');

    const row = await carRepository.create({
      ...listing,
      carType: model.name,
      ownerId: user.id,
      closesAt: addDays(new Date(), LIFETIME_DAYS[payload.kind] || LIFETIME_DAYS.OFFER),
      detail,
    });

    await authRepository.recordActivity({
      userId: user.id,
      action: 'CAR_CREATED',
      targetType: 'CAR',
      targetId: row.id,
      summary: `${row.kind} ${row.carType}`,
    });

    return toOwn(row);
  },

  /** The public list — numbered pages, the same contract as its siblings. */
  async list({ user, access, filters }) {
    const take = Math.min(filters.limit || LIST_PAGE_SIZE.DEFAULT, LIST_PAGE_SIZE.MAX);

    const where = {
      deletedAt: null,
      status: 'ACTIVE',
      closesAt: { gt: new Date() },
      owner: { status: 'ACTIVE' },
    };

    if (filters.kind) where.kind = filters.kind;
    if (filters.carModelId) where.carModelId = filters.carModelId;
    if (filters.brandId) where.carModel = { brandId: filters.brandId };
    if (filters.priceFrom) where.carPriceToman = { gte: BigInt(filters.priceFrom) };
    if (filters.priceTo) {
      where.carPriceToman = { ...(where.carPriceToman || {}), lte: BigInt(filters.priceTo) };
    }

    // This market's own columns reach the query through the relation — no
    // other market's query has to know these exist.
    const detail = {};
    if (filters.bodyType) detail.bodyType = filters.bodyType;
    if (filters.yearFrom) detail.year = { gte: filters.yearFrom };
    if (filters.yearTo) detail.year = { ...(detail.year || {}), lte: filters.yearTo };
    if (filters.maxMileage !== undefined) detail.mileageKm = { lte: filters.maxMileage };
    // Three cuts in the buyer's language rather than five grades to memorise.
    if (filters.body === 'NO_PAINT') detail.bodyGrade = 'NO_PAINT';
    if (filters.body === 'NO_REPLACE') {
      detail.bodyGrade = { in: ['NO_PAINT', 'MINOR_PAINT', 'PAINTED'] };
    }
    if (filters.body === 'CHASSIS_OK') detail.bodyGrade = { not: 'CHASSIS_DAMAGED' };
    if (Object.keys(detail).length) where.car = detail;

    const serialise = (rows, revealed) =>
      rows.map((row) =>
        row.ownerId === user.id
          ? toOwn(row, { viewerId: user.id })
          : toCard(row, { subscriptionActive: access.active, revealed: revealed.has(row.id) })
      );

    const page = Math.min(filters.page || 1, MAX_PAGE);
    const [rows, total] = await Promise.all([
      carRepository.listPublic({ where, skip: (page - 1) * take, take }),
      carRepository.count(where),
    ]);

    const revealed = await revealService.revealRepository.revealedIds(
      rows.map((r) => r.id),
      user.id
    );

    return {
      items: serialise(rows, revealed),
      total,
      page,
      pages: Math.max(1, Math.ceil(total / take)),
    };
  },

  async getById({ user, access, id }) {
    const row = await carRepository.findById(id);
    if (!row) throw new NotFoundError(NOT_FOUND);

    if (row.ownerId === user.id) return toOwn(row, { viewerId: user.id });
    if (row.owner.status !== 'ACTIVE') throw new NotFoundError(NOT_FOUND);

    const seen = await revealService.revealRepository.findReveal(id, user.id);
    return toCard(row, { subscriptionActive: access.active, revealed: Boolean(seen) });
  },

  /** The agency's own advertisements, family scopes included. */
  async listOwn({ user, filters }) {
    const take = Math.min(filters.limit || LIST_PAGE_SIZE.DEFAULT, LIST_PAGE_SIZE.MAX);
    const scope = user.isReseller ? filters.scope || 'all' : 'own';

    const where =
      scope === 'children'
        ? { owner: { parentId: user.id }, deletedAt: null }
        : scope === 'all'
          ? { OR: [{ ownerId: user.id }, { owner: { parentId: user.id } }], deletedAt: null }
          : { ownerId: user.id, deletedAt: null };

    if (filters.status) where.status = filters.status;

    const page = Math.min(filters.page || 1, MAX_PAGE);
    const [rows, total] = await Promise.all([
      carRepository.listOwn({ where, skip: (page - 1) * take, take }),
      carRepository.count(where),
    ]);

    return {
      items: rows.map((row) => toOwn(row, { viewerId: user.id })),
      total,
      page,
      pages: Math.max(1, Math.ceil(total / take)),
    };
  },

  async update({ user, id, payload }) {
    const row = await this.requireOwn(user, id);
    if (row.status !== 'ACTIVE') throw new BadRequestError(MESSAGES.HAVALE.NOT_EDITABLE);

    assertClean(freeText(payload), identity(user));
    if (payload.bodyStatus !== undefined) assertBody(payload.bodyStatus);

    const detail = detailPatch(payload);
    const updated = await carRepository.update(id, {
      ...(payload.description !== undefined ? { description: payload.description } : {}),
      ...(payload.carColor !== undefined ? { carColor: payload.carColor } : {}),
      ...(payload.carPriceToman !== undefined
        ? { carPriceToman: payload.carPriceToman === null ? null : BigInt(payload.carPriceToman) }
        : {}),
      detail,
      editedAt: new Date(),
      editCount: { increment: 1 },
    });

    await authRepository.recordActivity({
      userId: user.id,
      action: 'CAR_UPDATED',
      targetType: 'CAR',
      targetId: id,
      changes: [
        ...diffOf(row, payload, LISTING_FIELDS),
        ...diffOf(row.car || {}, payload, DETAIL_FIELDS),
      ],
    });

    return toOwn(updated, { viewerId: user.id });
  },

  async renew({ user, id }) {
    const row = await this.requireOwn(user, id);

    const updated = await carRepository.update(id, {
      status: 'ACTIVE',
      closesAt: addDays(new Date(), LIFETIME_DAYS[row.kind] || LIFETIME_DAYS.OFFER),
      renewedAt: new Date(),
      renewCount: { increment: 1 },
    });

    await authRepository.recordActivity({
      userId: user.id,
      action: 'CAR_RENEWED',
      targetType: 'CAR',
      targetId: id,
    });

    return toOwn(updated, { viewerId: user.id });
  },

  /** «فروخته شد» — the advertisement closes and becomes a record. */
  async markFulfilled({ user, id }) {
    await this.requireOwn(user, id);
    const updated = await carRepository.update(id, { status: 'FULFILLED' });

    await authRepository.recordActivity({
      userId: user.id,
      action: 'CAR_FULFILLED',
      targetType: 'CAR',
      targetId: id,
    });

    return toOwn(updated, { viewerId: user.id });
  },

  /** Soft removal, like everywhere: reveals and reports keep their target. */
  async remove({ user, id }) {
    await this.requireOwn(user, id);
    await carRepository.update(id, { deletedAt: new Date() });

    await authRepository.recordActivity({
      userId: user.id,
      action: 'CAR_DELETED',
      targetType: 'CAR',
      targetId: id,
    });

    return { id };
  },

  reveal({ user, access, id, ip }) {
    return revealService.reveal({
      user,
      access,
      id,
      ip,
      notFound: NOT_FOUND,
      targetType: 'CAR',
    });
  },

  /** Not-found rather than forbidden — an id must not confirm its existence. */
  async requireOwn(user, id) {
    const row = await carRepository.findById(id);
    if (!row || row.ownerId !== user.id) throw new NotFoundError(NOT_FOUND);
    return row;
  },
};

module.exports = carService;
module.exports.internals = { split, detailPatch };
