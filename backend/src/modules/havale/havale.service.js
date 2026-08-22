const { havaleRepository } = require('./havale.repository');
const { toHavaleCard, toOwnHavale, toRevealResult } = require('./havale.dto');
const authRepository = require('../auth/auth.repository');
const catalogRepository = require('../catalog/catalog.repository');
const brandAccess = require('../catalog/brandAccess.service');
const { NotFoundError, ForbiddenError, BadRequestError } = require('../../errors/AppError');
const { ERROR_CODES } = require('../../constants/errorCodes');
const { MESSAGES } = require('../../constants/messages');
const { startOfTehranDay, addDays } = require('../../utils/time');
const {
  HAVALE_KIND,
  HAVALE_STATUS,
  REQUEST_LIFETIME_DAYS,
  LIST_PAGE_SIZE,
} = require('../../constants/havale');

/**
 * Listings, and the rule that the contact details on them are never handed out
 * without being recorded first.
 */

/**
 * When a listing falls out of the public list.
 *
 * A sale listing lives exactly as long as the buyer's deposit window, because
 * once that window closes the offer is no longer real. A purchase request has no
 * such window, so it gets a fixed week (blueprint 13).
 */
function closingDate(kind, depositDays, from = new Date()) {
  return kind === HAVALE_KIND.OFFER
    ? addDays(from, depositDays)
    : addDays(from, REQUEST_LIFETIME_DAYS);
}

/**
 * The filter behind the public list.
 *
 * Three exclusions carry weight. Soft-deleted rows disappear from every agent's
 * view but stay in the admin panel with their violation history (blueprint 7.2).
 * Listings past `closesAt` drop out without a background job having to have run.
 * And a suspended agency's listings go with the account — leaving them up would
 * mean an agency we suspended for fraud keeps taking calls.
 */
function publicWhere(filters) {
  const where = {
    deletedAt: null,
    status: HAVALE_STATUS.ACTIVE,
    closesAt: { gt: new Date() },
    owner: { status: 'ACTIVE' },
  };

  if (filters.kind) where.kind = filters.kind;
  if (filters.solh) where.solh = filters.solh;
  if (filters.carModelId) where.carModelId = filters.carModelId;
  if (filters.brandId) where.carModel = { brandId: filters.brandId };
  if (filters.supplierCompany) where.supplierCompany = filters.supplierCompany;
  if (filters.model) where.model = filters.model;

  if (filters.carType) {
    where.carType = { contains: filters.carType, mode: 'insensitive' };
  }

  // A purchase request with no colour means "any colour will do", so filtering
  // by red must return it. Dropping it would invert its meaning — it was the
  // most willing match in the list (review round 1, fix 7).
  if (filters.carColor) {
    where.OR = [{ carColor: filters.carColor }, { carColor: null }];
  }

  if (filters.minAmount || filters.maxAmount) {
    where.amountToman = {};
    if (filters.minAmount) where.amountToman.gte = BigInt(filters.minAmount);
    if (filters.maxAmount) where.amountToman.lte = BigInt(filters.maxAmount);
  }

  if (filters.maxDeliveryDays) where.deliveryDays = { lte: filters.maxDeliveryDays };

  return where;
}

function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const [createdAt, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    const date = new Date(createdAt);
    if (Number.isNaN(date.getTime()) || !id) return null;
    return { createdAt: date, id };
  } catch {
    // A malformed cursor is a client bug, not an attack surface — start over
    // rather than fail the request.
    return null;
  }
}

function encodeCursor(row) {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`).toString('base64url');
}

const havaleService = {
  async create({ user, payload }) {
    const { carModelId, carColor, ...rest } = payload;
    const catalog = await this.resolveCatalog({ carModelId, carColor });

    // Offers only. A purchase request is a statement of what somebody wants to
    // buy, and an agency that handles Peugeot still buys whatever its customer
    // walked in asking for — restricting that would stop deals rather than
    // divide them. Placed in the service and not the route so no future caller
    // can reach the write without it.
    if (payload.kind === HAVALE_KIND.OFFER) {
      await brandAccess.assertMayPost({ userId: user.id, carModelId });
    }

    const closesAt = closingDate(payload.kind, payload.depositDays);

    const havale = await havaleRepository.create({
      ...rest,
      ...catalog,
      ownerId: user.id,
      closesAt,
    });

    await authRepository.recordActivity({
      userId: user.id,
      action: 'HAVALE_CREATED',
      targetType: 'HAVALE',
      targetId: havale.id,
      summary: `${havale.kind} ${havale.carType}`,
    });

    return toOwnHavale(havale);
  },

  /**
   * The public list.
   *
   * Every row goes through the masking serialiser, and which reveals this viewer
   * already owns is fetched in one query rather than one per row — the same
   * information, without turning a twenty-row page into twenty-one round trips.
   */
  async list({ user, access, filters }) {
    const take = Math.min(filters.limit || LIST_PAGE_SIZE.DEFAULT, LIST_PAGE_SIZE.MAX);
    const where = publicWhere(filters);

    // "Only my network": listings posted by the same main agency's accounts —
    // the parent and its sub-agencies. Only members of a network have one to
    // filter by; for anyone else the option resolves to nothing and the filter
    // is ignored rather than failing, mirroring the interface, which does not
    // offer it to them.
    if (filters.network === 'mine') {
      const rootId = user.parentId || (user.isReseller ? user.id : null);
      if (rootId) where.ownerId = { in: await havaleRepository.networkMemberIds(rootId) };
    }

    // Two paginations, deliberately. The panel shows people numbered pages —
    // "۳ از ۱۲" answers "how much is there?", which a bare next-cursor never
    // can. Offset does re-scan skipped rows, but a human clicking page numbers
    // stays shallow; the cursor path below remains for clients that walk the
    // whole list, where depth is exactly the problem.
    if (filters.page) {
      const [rows, total] = await Promise.all([
        havaleRepository.list({ where, skip: (filters.page - 1) * take, take }),
        havaleRepository.count(where),
      ]);

      const revealed = access.active
        ? await havaleRepository.findRevealedIds(
            rows.filter((h) => h.ownerId !== user.id).map((h) => h.id),
            user.id
          )
        : new Set();

      return {
        items: rows.map((h) =>
          h.ownerId === user.id
            ? toOwnHavale(h)
            : toHavaleCard(h, { subscriptionActive: access.active, revealed: revealed.has(h.id) })
        ),
        total,
        page: filters.page,
        pages: Math.max(1, Math.ceil(total / take)),
      };
    }

    const cursor = decodeCursor(filters.cursor);
    const rows = await havaleRepository.list({ where, cursor, take: take + 1 });

    const hasNext = rows.length > take;
    const page = hasNext ? rows.slice(0, take) : rows;

    const revealed = access.active
      ? await havaleRepository.findRevealedIds(
          page.filter((h) => h.ownerId !== user.id).map((h) => h.id),
          user.id
        )
      : new Set();

    return {
      items: page.map((h) =>
        h.ownerId === user.id
          ? toOwnHavale(h)
          : toHavaleCard(h, { subscriptionActive: access.active, revealed: revealed.has(h.id) })
      ),
      nextCursor: hasNext ? encodeCursor(page[page.length - 1]) : null,
    };
  },

  async getById({ user, access, id }) {
    const havale = await havaleRepository.findById(id);
    if (!havale) throw new NotFoundError('حواله');

    if (havale.ownerId === user.id) return toOwnHavale(havale);

    // A reseller opening its own sub-agency's listing sees it whole, the way
    // the owner does — the family's listings are the parent's to know.
    if (user.isReseller && havale.owner.parentId === user.id) {
      return { ...toOwnHavale(havale), isOwn: false };
    }

    // A listing whose owner is suspended, or which is closed, is not browsable
    // by its id either. Otherwise the id is a way around the list filter.
    if (havale.owner.status !== 'ACTIVE' || havale.status !== HAVALE_STATUS.ACTIVE) {
      throw new NotFoundError('حواله');
    }

    const reveal = access.active ? await havaleRepository.findReveal(id, user.id) : null;
    return toHavaleCard(havale, { subscriptionActive: access.active, revealed: Boolean(reveal) });
  },

  /**
   * Listings belonging to the signed-in agent, including closed and expired
   * ones — and, for a reseller, its sub-agencies' too.
   *
   * The scope is honoured only for resellers, and only over accounts whose
   * parentId is this very user: the widest thing anyone can ask for is their
   * own family. A child's row keeps its own agency on it and comes back with
   * isOwn false, so the panel knows not to offer edit buttons the server
   * would refuse.
   */
  async listOwn({ user, filters }) {
    const take = Math.min(filters.limit || LIST_PAGE_SIZE.DEFAULT, LIST_PAGE_SIZE.MAX);
    const cursor = decodeCursor(filters.cursor);

    const scope = user.isReseller ? filters.scope || 'own' : 'own';
    const where =
      scope === 'children'
        ? { owner: { parentId: user.id }, deletedAt: null }
        : scope === 'all'
          ? { OR: [{ ownerId: user.id }, { owner: { parentId: user.id } }], deletedAt: null }
          : { ownerId: user.id, deletedAt: null };
    if (filters.status) where.status = filters.status;

    const rows = await havaleRepository.list({ where, cursor, take: take + 1 });
    const hasNext = rows.length > take;
    const page = hasNext ? rows.slice(0, take) : rows;

    return {
      items: page.map((h) => ({ ...toOwnHavale(h), isOwn: h.ownerId === user.id })),
      nextCursor: hasNext ? encodeCursor(page[page.length - 1]) : null,
    };
  },

  async update({ user, id, payload }) {
    const havale = await this.requireOwn(user, id);

    if (havale.status !== HAVALE_STATUS.ACTIVE) {
      throw new BadRequestError(MESSAGES.HAVALE.NOT_EDITABLE);
    }

    const { carModelId, carColor, ...rest } = payload;
    const catalog = await this.resolveCatalog({ carModelId, carColor });

    // The same rule as on create, and for the same reason: an edit can change
    // the model, so a listing posted under an allowed brand could otherwise be
    // walked over to one this account was never given. Checked against the
    // listing's own kind, not the payload's — the kind cannot be edited.
    if (carModelId !== undefined && havale.kind === HAVALE_KIND.OFFER) {
      await brandAccess.assertMayPost({ userId: user.id, carModelId });
    }

    const updated = await havaleRepository.update(id, { ...rest, ...catalog });
    await authRepository.recordActivity({
      userId: user.id,
      action: 'HAVALE_UPDATED',
      targetType: 'HAVALE',
      targetId: id,
    });
    return toOwnHavale(updated);
  },

  /**
   * Renewal.
   *
   * The delivery time is asked for again rather than carried over, because it was
   * quoted in days from the original posting date — after two renewals the
   * number on screen would be describing a date in the past (review round 1,
   * fix 6).
   *
   * Renewal needs a live subscription for the same reason posting does: without
   * that, an agency that stopped paying could keep its listings at the top of
   * the list forever with a weekly click (blueprint 7.1). That check is on the
   * route, not here.
   */
  async renew({ user, id, deliveryDays, depositDays }) {
    const havale = await this.requireOwn(user, id);

    if (havale.status === HAVALE_STATUS.SUSPENDED) {
      throw new ForbiddenError(MESSAGES.HAVALE.SUSPENDED);
    }

    const now = new Date();
    const updated = await havaleRepository.update(id, {
      status: HAVALE_STATUS.ACTIVE,
      deliveryDays: deliveryDays ?? havale.deliveryDays,
      depositDays: depositDays ?? havale.depositDays,
      closesAt: closingDate(havale.kind, depositDays ?? havale.depositDays, now),
      renewedAt: now,
      renewCount: { increment: 1 },
    });

    await authRepository.recordActivity({
      userId: user.id,
      action: 'HAVALE_RENEWED',
      targetType: 'HAVALE',
      targetId: id,
    });
    return toOwnHavale(updated);
  },

  /** "Sold" — out of the public list, still in the admin panel (blueprint 14). */
  async markFulfilled({ user, id }) {
    await this.requireOwn(user, id);
    const updated = await havaleRepository.update(id, { status: HAVALE_STATUS.FULFILLED });
    await authRepository.recordActivity({
      userId: user.id,
      action: 'HAVALE_FULFILLED',
      targetType: 'HAVALE',
      targetId: id,
    });
    return toOwnHavale(updated);
  },

  /**
   * Soft delete.
   *
   * A hard delete would take the violation reports and the reveal history with
   * it, which turned deletion into an escape route: post a fake listing, take
   * the calls, delete it before anyone reports it (review round 1, fix 2 and
   * round 3, fix 7).
   */
  async remove({ user, id }) {
    await this.requireOwn(user, id);
    await havaleRepository.update(id, { deletedAt: new Date() });
    await authRepository.recordActivity({
      userId: user.id,
      action: 'HAVALE_DELETED',
      targetType: 'HAVALE',
      targetId: id,
    });
    return { deleted: true };
  },

  /**
   * Reveal the coordinator's contact details.
   *
   * The recording is the product. The button exists so that every look at a
   * phone number leaves a row with who, which listing, when, from where, and the
   * number as it read at that moment — which is what the monitoring report, the
   * cap and the "unreachable" violation reason are all built on.
   */
  async reveal({ user, access, id, ip }) {
    const havale = await havaleRepository.findById(id);
    if (!havale) throw new NotFoundError('حواله');

    if (havale.ownerId === user.id) {
      throw new BadRequestError(MESSAGES.HAVALE.OWN_CONTACT);
    }

    if (havale.owner.status !== 'ACTIVE') throw new NotFoundError('حواله');

    // Already opened: hand it back without charging again. The unique constraint
    // on (havale, viewer) makes that the natural behaviour rather than something
    // to remember — an agent who closes the tab has not used up a second view.
    const existing = await havaleRepository.findReveal(id, user.id);
    if (existing) {
      return toRevealResult(havale.owner, await this.revealUsage({ user, access }));
    }

    const usage = await this.revealUsage({ user, access });

    if (usage.dailyUsed >= usage.dailyLimit) {
      throw new ForbiddenError(MESSAGES.HAVALE.DAILY_LIMIT, ERROR_CODES.REVEAL_LIMIT_REACHED);
    }
    if (usage.monthlyUsed >= usage.monthlyLimit) {
      throw new ForbiddenError(MESSAGES.HAVALE.MONTHLY_LIMIT, ERROR_CODES.REVEAL_LIMIT_REACHED);
    }

    await havaleRepository.createReveal({
      havaleId: id,
      viewerId: user.id,
      ip,
      // The number as it read at this moment. Contact details can be changed
      // later through a ticket, and without this the log would quietly rewrite
      // history to show the new number (review round 3, fix 6).
      phoneShown: havale.owner.coordinatorPhone,
      agencyCodeShown: havale.owner.agencyCode,
    });

    await authRepository.recordActivity({
      userId: user.id,
      action: 'CONTACT_REVEALED',
      targetType: 'HAVALE',
      targetId: id,
      summary: havale.owner.agencyCode,
      ip,
    });

    return toRevealResult(havale.owner, {
      ...usage,
      dailyUsed: usage.dailyUsed + 1,
      monthlyUsed: usage.monthlyUsed + 1,
    });
  },

  /**
   * How much of the allowance is gone.
   *
   * The day is a calendar day in Tehran; the month is this subscription's
   * thirty-day period rather than a Jalali month, so renewing early cannot be
   * used to reset the allowance (review round 3, fix 2).
   */
  async revealUsage({ user, access }) {
    const [dailyUsed, monthlyUsed] = await Promise.all([
      havaleRepository.countRevealsSince(user.id, startOfTehranDay()),
      access.periodStart
        ? havaleRepository.countRevealsSince(user.id, access.periodStart)
        : Promise.resolve(0),
    ]);

    return {
      dailyUsed,
      dailyLimit: access.dailyLimit,
      monthlyUsed,
      monthlyLimit: access.monthlyLimit,
    };
  },

  /**
   * Turns catalogue choices into the values stored on the listing.
   *
   * The model's name and its company are copied onto the row rather than only
   * referenced. A listing has to keep saying what it said when it was posted: if
   * the operator renames a model next year, an agent looking at an old حواله
   * would otherwise see a car description that changed underneath them — and the
   * violation reports filed against it would stop matching what was advertised.
   */
  async resolveCatalog({ carModelId, carColor }) {
    const data = {};

    if (carModelId !== undefined && carModelId !== null) {
      const model = await catalogRepository.findModel(carModelId);
      if (!model) throw new BadRequestError(MESSAGES.HAVALE.UNKNOWN_MODEL);

      data.carModelId = model.id;
      data.carType = model.name;
      // The company when the brand has one, otherwise the brand itself. Most
      // brands have no company — the market list has no manufacturer level and
      // guessing one would file cars under makers that do not build them — and
      // reading `.company.name` through that blank threw, turning every listing
      // on such a brand into a 500. The brand name is also the better answer:
      // «شرکت: پژو» tells a reader something, «شرکت: —» does not.
      data.supplierCompany = model.brand.company?.name || model.brand.name;
    }

    if (carColor !== undefined && carColor !== null) {
      const colour = await catalogRepository.findColorByName(carColor);
      if (!colour) throw new BadRequestError(MESSAGES.HAVALE.UNKNOWN_COLOR);
      data.carColor = colour.name;
    } else if (carColor === null) {
      data.carColor = null;
    }

    return data;
  },

  async requireOwn(user, id) {
    const havale = await havaleRepository.findById(id);
    if (!havale) throw new NotFoundError('حواله');
    // Not-found rather than forbidden: telling a stranger that a listing exists
    // but is not theirs is information they did not have a moment ago.
    if (havale.ownerId !== user.id) throw new NotFoundError('حواله');
    return havale;
  },
};

module.exports = havaleService;
// Exposed for tests only. The rules above are the interface; these are the
// pieces the tests need to pin down without going through HTTP.
module.exports.internals = { closingDate, publicWhere, encodeCursor, decodeCursor };
