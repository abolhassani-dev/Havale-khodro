const { registrationRepository } = require('./registration.repository');
const { toCard, toOwn } = require('./registration.dto');
const { REGISTRATION_KIND, LIFETIME_DAYS } = require('./registration.constants');
const revealService = require('../listing/reveal.service');
const catalogRepository = require('../catalog/catalog.repository');
const brandAccess = require('../catalog/brandAccess.service');
const authRepository = require('../auth/auth.repository');
const { addDays } = require('../../utils/time');
const { diffOf } = require('../../utils/diff');
const { assertClean } = require('../../utils/textGuard');
const { LIST_PAGE_SIZE, MAX_PAGE } = require('../../constants/havale');
const { MESSAGES } = require('../../constants/messages');
const { NotFoundError, BadRequestError } = require('../../errors/AppError');

/**
 * The ثبت‌نامی market: capacity in a factory scheme, offered and sought.
 *
 * What is traded here is a slot that has not been registered yet — not a
 * registration already made. That single decision is why there is no tracking
 * code, no lottery result and no invitation anywhere in this module: none of
 * them exist at the moment the advertisement is posted.
 *
 * Everything this market shares with the others — who may see a contact and
 * what it costs, who may post under which brand, how a violation is reported —
 * comes from the kernel and the catalogue, not from here. What lives here is
 * only what makes this market itself.
 */

const NOT_FOUND = 'آگهی ثبت‌نامی';

/**
 * When the advertisement stops being true.
 *
 * A capacity offer dies with the scheme's own deadline, because that is the day
 * it stops being an offer — capped at a month so a scheme with a distant
 * deadline cannot leave a stale advertisement standing all season. Without a
 * deadline, and for a request, it is a fixed window.
 */
function closingDate(kind, registerDeadline, from = new Date()) {
  if (kind === REGISTRATION_KIND.REQUEST) return addDays(from, LIFETIME_DAYS.REQUEST);

  const cap = addDays(from, LIFETIME_DAYS.MAX_OFFER);
  if (!registerDeadline) return addDays(from, LIFETIME_DAYS.DEFAULT_OFFER);

  const deadline = new Date(registerDeadline);
  return deadline < cap ? deadline : cap;
}

/** Splits a payload into the shared listing columns and this market's own. */
function split(payload) {
  const {
    kind,
    carModelId,
    description,
    planName,
    method,
    saleType,
    capacity,
    depositToman,
    premiumToman,
    registerDeadline,
    deliveryEstimate,
    conditions,
  } = payload;

  return {
    listing: { kind, carModelId, description },
    detail: {
      planName: planName || null,
      method: method || null,
      saleType: saleType || null,
      capacity: capacity ?? null,
      depositToman: depositToman === undefined || depositToman === null ? null : BigInt(depositToman),
      premiumToman: premiumToman === undefined || premiumToman === null ? null : BigInt(premiumToman),
      registerDeadline: registerDeadline ? new Date(registerDeadline) : null,
      deliveryEstimate: deliveryEstimate || null,
      conditions: conditions || null,
    },
  };
}

/** Only the keys the caller actually sent, so an edit cannot blank a field. */
/**
 * The fields an edit is worth recording, and what to call them in the log.
 *
 * Here rather than in a shared table because they are this market's own
 * vocabulary — خودرو and قطعات will have different ones, and neither should
 * have to know about this list. The label travels with the recorded change, so
 * an entry written today still reads correctly if a field is renamed later.
 */
const LISTING_FIELDS = { description: ['توضیحات'] };

const DETAIL_FIELDS = {
  planName: ['نام طرح'],
  method: ['روش ثبت‌نام'],
  saleType: ['نوع فروش'],
  capacity: ['تعداد ظرفیت', 'number'],
  depositToman: ['قیمت خودرو', 'money'],
  premiumToman: ['مبلغ امتیاز', 'money'],
  registerDeadline: ['مهلت ثبت‌نام', 'date'],
  deliveryEstimate: ['موعد تحویل'],
  conditions: ['شرایط ثبت‌نام‌کننده'],
};

function detailPatch(payload) {
  const { detail } = split({ ...payload });
  const out = {};
  for (const key of Object.keys(detail)) {
    if (payload[key] !== undefined) out[key] = detail[key];
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Every box on this market that takes typing, and what to call it in a refusal.
 *
 * Written as one list rather than repeated at each call site, because the field
 * this list forgot was «موعد تحویل» — and a telephone number went out on the
 * market inside it while three other boxes were being carefully guarded. A new
 * text field is now guarded by being added here, which is the same place it has
 * to be added anyway.
 */
function freeText(payload) {
  return {
    'نام طرح': payload.planName,
    شرایط: payload.conditions,
    'موعد تحویل': payload.deliveryEstimate,
    توضیحات: payload.description,
  };
}

/**
 * What this account is, so the guard can refuse it identifying itself.
 *
 * `strictIdentity` names the boxes where the word «نمایندگی» alone is enough:
 * a factory scheme is never called that, so in the scheme-name box it can only
 * be somebody signing their advertisement.
 */
function identity(user) {
  return {
    agencyCode: user.agencyCode,
    agencyName: user.agencyName,
    strictIdentity: ['نام طرح'],
  };
}

const registrationService = {
  async create({ user, payload }) {
    // Three free-text boxes here rather than one, and the scheme name is the
    // worst of them: it is the field an agency is most tempted to sign, because
    // it reads like a title. See utils/textGuard.
    assertClean(freeText(payload), identity(user));

    const { listing, detail } = split(payload);

    // The car's name is copied onto the row rather than only referenced. An
    // advertisement has to keep saying what it said when it was posted: if the
    // operator renames a model next year, an agency looking at an old one would
    // otherwise see a car description that changed underneath it.
    const model = await catalogRepository.findModel(payload.carModelId);
    if (!model) throw new BadRequestError(MESSAGES.LISTING.UNKNOWN_MODEL);

    // Offers only — the same rule as the حواله market, for the same reason. An
    // agency that handles Peugeot still buys whatever its customer walked in
    // asking for, so restricting a *request* would stop deals rather than
    // divide them. In the service and not the route, so no future caller can
    // reach the write without it.
    if (payload.kind === REGISTRATION_KIND.OFFER) {
      await brandAccess.assertMayPost({ userId: user.id, carModelId: payload.carModelId });
    }

    const row = await registrationRepository.create({
      ...listing,
      carType: model.name,
      ownerId: user.id,
      closesAt: closingDate(payload.kind, payload.registerDeadline),
      detail,
    });

    await authRepository.recordActivity({
      userId: user.id,
      action: 'REGISTRATION_CREATED',
      targetType: 'REGISTRATION',
      targetId: row.id,
      summary: `${row.kind} ${row.carType}`,
    });

    return toOwn(row);
  },

  /**
   * The public list.
   *
   * Every row goes through the masking serialiser, and which reveals this
   * viewer already owns is fetched in one query rather than one per row.
   */
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
    if (filters.city) where.owner = { ...where.owner, city: filters.city };

    // Filters that live on this market's own table reach it through the
    // relation, which is exactly the isolation this design is for: no other
    // market's query has to know these columns exist.
    const detail = {};
    if (filters.method) detail.method = filters.method;
    if (filters.saleType) detail.saleType = filters.saleType;
    if (filters.maxPremium) detail.premiumToman = { lte: BigInt(filters.maxPremium) };
    if (Object.keys(detail).length) where.registration = detail;

    // One row, serialised the way this viewer is entitled to see it.
    const serialise = (rows, revealed) =>
      rows.map((row) =>
        row.ownerId === user.id
          ? toOwn(row, { viewerId: user.id })
          : toCard(row, { subscriptionActive: access.active, revealed: revealed.has(row.id) })
      );

    // Two paginations, the same pair the حواله market carries and for the same
    // reason. The panel shows people numbered pages, because «۳ از ۱۲» answers
    // «how much is there?» and a bare next-cursor never can — and until this
    // existed the ثبت‌نامی page showed the first twenty advertisements and said
    // nothing at all about the rest, which reads as «this is the whole market».
    //
    // Offset does re-scan the rows it skips, so the page number is capped: see
    // MAX_PAGE. The cursor path below stays for anything that walks the whole
    // list, where depth is exactly the problem.
    if (filters.page) {
      const page = Math.min(filters.page, MAX_PAGE);
      const [rows, total] = await Promise.all([
        registrationRepository.listPublic({ where, skip: (page - 1) * take, take }),
        registrationRepository.count(where),
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
    }

    const rows = await registrationRepository.listPublic({
      where,
      take: take + 1,
      cursor: filters.cursor ? { id: filters.cursor } : null,
    });

    const hasNext = rows.length > take;
    const page = hasNext ? rows.slice(0, take) : rows;

    const revealed = await revealService.revealRepository.revealedIds(
      page.map((r) => r.id),
      user.id
    );

    return {
      items: serialise(page, revealed),
      nextCursor: hasNext ? page[page.length - 1].id : null,
    };
  },

  async getById({ user, access, id }) {
    const row = await registrationRepository.findById(id);
    if (!row) throw new NotFoundError(NOT_FOUND);

    if (row.ownerId === user.id) return toOwn(row, { viewerId: user.id });
    if (row.owner.status !== 'ACTIVE') throw new NotFoundError(NOT_FOUND);

    const seen = await revealService.revealRepository.findReveal(id, user.id);
    return toCard(row, { subscriptionActive: access.active, revealed: Boolean(seen) });
  },

  /**
   * The agency's own advertisements — and, for a central agency, its family's.
   *
   * The three scopes are the same ones the حواله market offers, because a
   * parent thinks about its sub-agencies the same way in either: everything,
   * mine only, or theirs only. A sub-agency sends no scope and is pinned to its
   * own, which is enforced here rather than trusted from the query.
   */
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

    // Numbered, like the market list. An agency with sixty advertisements used
    // to see fifty of them and nothing said the other ten existed — a list that
    // is quietly short tells the reader «that is all of it».
    const page = Math.min(filters.page || 1, MAX_PAGE);
    const [rows, total] = await Promise.all([
      registrationRepository.listOwn({ where, skip: (page - 1) * take, take }),
      registrationRepository.count(where),
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
    if (row.status !== 'ACTIVE') throw new BadRequestError(MESSAGES.LISTING.NOT_EDITABLE);

    // On the edit too: writing clean text and editing the number in afterwards
    // is the obvious way round a check that only runs once.
    assertClean(freeText(payload), identity(user));

    const detail = detailPatch(payload);
    const updated = await registrationRepository.update(id, {
      ...(payload.description !== undefined ? { description: payload.description } : {}),
      // The deadline moves the advertisement's own life with it: an agency that
      // corrects the scheme's date expects the advertisement to follow, not to
      // keep dying on the old one.
      ...(payload.registerDeadline !== undefined
        ? { closesAt: closingDate(row.kind, payload.registerDeadline) }
        : {}),
      detail,
      // Marked as edited, exactly as in the حواله market. `updatedAt` moves on
      // every write and so cannot say whether the *owner* changed anything.
      editedAt: new Date(),
      editCount: { increment: 1 },
    });

    await authRepository.recordActivity({
      userId: user.id,
      action: 'REGISTRATION_UPDATED',
      targetType: 'REGISTRATION',
      targetId: id,
      // What actually moved. The listing's own column and the market's detail
      // columns live in two records, so they are diffed against two befores and
      // joined — the log does not care which table a field came from.
      changes: [
        ...diffOf(row, payload, LISTING_FIELDS),
        ...diffOf(row.registration || {}, payload, DETAIL_FIELDS),
      ],
    });

    return toOwn(updated, { viewerId: user.id });
  },

  /**
   * Renewal — a fresh window from today.
   *
   * It needs a live subscription for the same reason posting does: without
   * that, an agency that stopped paying could keep its advertisements at the
   * top of the list forever with a weekly click.
   */
  async renew({ user, id, registerDeadline }) {
    const row = await this.requireOwn(user, id);

    const updated = await registrationRepository.update(id, {
      status: 'ACTIVE',
      closesAt: closingDate(row.kind, registerDeadline ?? row.registration?.registerDeadline),
      renewedAt: new Date(),
      renewCount: { increment: 1 },
      ...(registerDeadline !== undefined
        ? { detail: { registerDeadline: registerDeadline ? new Date(registerDeadline) : null } }
        : {}),
    });

    await authRepository.recordActivity({
      userId: user.id,
      action: 'REGISTRATION_RENEWED',
      targetType: 'REGISTRATION',
      targetId: id,
    });

    return toOwn(updated, { viewerId: user.id });
  },

  /** «واگذار شد» — the capacity is gone, so the advertisement closes. */
  async markFulfilled({ user, id }) {
    await this.requireOwn(user, id);
    const updated = await registrationRepository.update(id, { status: 'FULFILLED' });

    await authRepository.recordActivity({
      userId: user.id,
      action: 'REGISTRATION_FULFILLED',
      targetType: 'REGISTRATION',
      targetId: id,
    });

    return toOwn(updated, { viewerId: user.id });
  },

  /**
   * Removal is soft.
   *
   * The row stays so the reveals people paid for and any violation report filed
   * against it still point at something. From the market's side it is gone.
   */
  async remove({ user, id }) {
    await this.requireOwn(user, id);
    await registrationRepository.update(id, { deletedAt: new Date() });

    await authRepository.recordActivity({
      userId: user.id,
      action: 'REGISTRATION_DELETED',
      targetType: 'REGISTRATION',
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
      targetType: 'REGISTRATION',
    });
  },

  /**
   * Not-found rather than forbidden for somebody else's advertisement.
   *
   * Answering 403 would confirm that this id exists, which is a small leak that
   * costs nothing to avoid.
   */
  async requireOwn(user, id) {
    const row = await registrationRepository.findById(id);
    if (!row || row.ownerId !== user.id) throw new NotFoundError(NOT_FOUND);
    return row;
  },
};

module.exports = registrationService;
module.exports.internals = { closingDate, split, detailPatch };
