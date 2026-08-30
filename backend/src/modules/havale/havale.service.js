const { havaleRepository } = require('./havale.repository');
const { toHavaleCard, toOwnHavale } = require('./havale.dto');
const authRepository = require('../auth/auth.repository');
const revealService = require('../listing/reveal.service');
const catalogRepository = require('../catalog/catalog.repository');
const brandAccess = require('../catalog/brandAccess.service');
const { NotFoundError, ForbiddenError, BadRequestError } = require('../../errors/AppError');
const { MESSAGES } = require('../../constants/messages');
const { addDays } = require('../../utils/time');
const { diffOf } = require('../../utils/diff');
const { assertClean } = require('../../utils/textGuard');
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

/**
 * The fields an edit is worth recording, and what to call them in the log.
 *
 * This market's own vocabulary — ثبت‌نامی keeps its own list, and خودرو will
 * keep a third. The label is stored with each recorded change, so an entry
 * written today still reads correctly if a field is renamed later.
 *
 * `carModelId` is deliberately absent and `carType` is here instead: the id
 * changing tells a reader nothing, and «از پژو ۲۰۷ به سمند» tells them
 * everything.
 */
const EDIT_FIELDS = {
  carType: ['مدل خودرو'],
  carColor: ['رنگ'],
  model: ['سال'],
  solh: ['نوع واگذاری'],
  amountToman: ['مبلغ حواله', 'money'],
  carPriceToman: ['قیمت خودرو', 'money'],
  paidAmountToman: ['مبلغ واریزشده', 'money'],
  paymentType: ['نحوه پرداخت'],
  deliveryDays: ['زمان تحویل (روز)', 'number'],
  depositDays: ['مهلت واریز (روز)', 'number'],
  supplierCompany: ['تأمین‌کننده'],
  description: ['توضیحات'],
};

const havaleService = {
  async create({ user, payload }) {
    // Before anything is written. The description is the one field on this form
    // with no shape at all, and a contact number inside it hands the market a
    // free directory — every reveal that would have been paid for, given away
    // in one line. See utils/textGuard for why this is one layer of several.
    assertClean({ توضیحات: payload.description }, { agencyCode: user.agencyCode });

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

    // Checked on an edit as well, and not as an afterthought: posting clean
    // text and editing the number in afterwards is the obvious way round a
    // check that only runs once.
    assertClean({ توضیحات: payload.description }, { agencyCode: user.agencyCode });

    // The car itself is not editable, and neither is the kind. Everything on
    // the card is negotiable except what the card *is*: an advertisement that
    // three hundred agencies read as «پژو ۲۰۷، ۹۵۰ میلیون» must not quietly
    // become a پراید on the same row, keeping its age and its view count. The
    // way to sell a different car is to post a different advertisement.
    //
    // It closes a second hole for free: an edit used to be able to walk a
    // listing onto a brand this account was never granted, so the brand check
    // had to be repeated here. With the model frozen there is nothing to walk.
    const { carColor, ...rest } = payload;
    const catalog = await this.resolveCatalog({ carColor });

    const updated = await havaleRepository.update(id, {
      ...rest,
      ...catalog,
      // Not `updatedAt`: that moves on every write — a renewal, a sale, the
      // view counter — so it cannot answer «has the owner changed this?».
      editedAt: new Date(),
      editCount: { increment: 1 },
    });
    await authRepository.recordActivity({
      userId: user.id,
      action: 'HAVALE_UPDATED',
      targetType: 'HAVALE',
      targetId: id,
      // `catalog` rather than the raw payload for the car, because the payload
      // carries ids and the log has to be readable without them: what changed
      // is «پژو ۲۰۷» to «سمند», not one cuid to another.
      changes: diffOf(havale, { ...rest, ...catalog }, EDIT_FIELDS),
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
  /**
   * Both of these are the kernel's, not this market's.
   *
   * Showing a contact and counting what it cost are the same act in every
   * market — see modules/listing/reveal.service. Keeping a copy here would
   * mean two versions of the one rule the business runs on.
   */
  reveal({ user, access, id, ip }) {
    return revealService.reveal({ user, access, id, ip, notFound: 'حواله', targetType: 'HAVALE' });
  },

  revealUsage({ user, access }) {
    return revealService.usageFor({ user, access });
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
