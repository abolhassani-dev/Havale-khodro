const { prisma } = require('../../config/database');
const { ForbiddenError, BadRequestError } = require('../../errors/AppError');

/**
 * Which cars an account may post under.
 *
 * The rule in one sentence: an agency can *see* the whole market and can ask
 * to buy anything, but may only *offer* what it was given. That is how a main
 * agency divides work between twenty sub-agencies — one for Iran Khodro
 * products, one that handles nothing but a single Fownix model — without any
 * of them losing sight of the market they are trading in.
 *
 * Two grains, deliberately:
 *
 *   A brand grant means "every model of this brand, now and in future". It is
 *   the ordinary case, and it keeps following the brand as models are added.
 *
 *   A model grant means "exactly this one", for the agency whose whole job is
 *   one car. Stored only when the brand is not already granted — a model row
 *   under a granted brand would be a duplicate that stops meaning anything
 *   the day the brand grant is removed.
 *
 * Three consequences stay load-bearing from the brand-only days:
 *
 *   Searching and viewing are untouched — a division of labour, not a wall.
 *   Purchase requests are untouched — wanting a car is not dealing in it.
 *   No rows means nothing, not everything — the safe default for an account
 *   somebody forgot to configure.
 */

/**
 * Everything this account holds: whole brands, and single models.
 *
 * Model grants come back with their brand, because every consumer needs the
 * pair — the form to know which brand is partially open, the picker to show
 * a count on the right row — and none of them should have to join it back.
 */
async function allowedSets(userId) {
  const [brands, models] = await Promise.all([
    prisma.brandAccess.findMany({ where: { userId }, select: { brandId: true } }),
    prisma.modelAccess.findMany({
      where: { userId },
      select: { carModelId: true, carModel: { select: { brandId: true } } },
    }),
  ]);
  return {
    brandIds: brands.map((r) => r.brandId),
    modelGrants: models.map((r) => ({ id: r.carModelId, brandId: r.carModel.brandId })),
  };
}

/** Kept for callers that only care about whole brands. */
async function allowedBrandIds(userId) {
  return (await allowedSets(userId)).brandIds;
}

/**
 * The picker's data: every active brand flagged, plus the ids of singly
 * granted models so a partial brand can show as partial.
 *
 * Deliberately *without* the models themselves — 2044 of them made this the
 * heaviest response in the product, fetched by four different screens. The
 * picker fetches one brand's models when somebody opens that brand, which is
 * the only time anybody looks at them.
 */
async function brandChoices(userId) {
  const [brands, allowed] = await Promise.all([
    prisma.carBrand.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        slug: true,
        logo: true,
        _count: { select: { models: { where: { isActive: true } } } },
      },
    }),
    userId ? allowedSets(userId) : { brandIds: [], modelGrants: [] },
  ]);

  const on = new Set(allowed.brandIds);
  return {
    brands: brands.map((b) => ({ ...b, allowed: on.has(b.id) })),
    modelGrants: allowed.modelGrants,
  };
}

/**
 * Replaces an account's grants — both grains, one transaction.
 *
 * Delete-then-insert rather than a diff: the set is small, and a half-applied
 * change here is an agency that can suddenly post things nobody chose.
 */
async function setBrands({ userId, brandIds, modelIds = [], limitTo = null }) {
  const wantedBrands = [...new Set(brandIds || [])];
  let wantedModels = [...new Set(modelIds || [])];

  // Every id has to be real and active — a stale picker, or a hand-made
  // request, must not write rows that point at nothing.
  const realBrands = await prisma.carBrand.findMany({
    where: { id: { in: wantedBrands }, isActive: true },
    select: { id: true },
  });
  if (realBrands.length !== wantedBrands.length) {
    throw new BadRequestError('برند نامعتبر انتخاب شده است');
  }

  const realModels = await prisma.carModel.findMany({
    where: { id: { in: wantedModels }, isActive: true },
    select: { id: true, brandId: true },
  });
  if (realModels.length !== wantedModels.length) {
    throw new BadRequestError('مدل نامعتبر انتخاب شده است');
  }

  // A model row under a granted brand is dropped, not stored. The brand grant
  // already says yes to it — and to every model the brand gains later, which
  // is what the duplicate row would quietly stop meaning.
  const brandSet = new Set(wantedBrands);
  const modelRows = realModels.filter((m) => !brandSet.has(m.brandId));
  wantedModels = modelRows.map((m) => m.id);

  // A parent may only hand out what it holds: a whole brand only if it holds
  // the brand; a single model if it holds the brand or that very model.
  // Checked here rather than in the route so no future caller can reach the
  // write without it.
  if (limitTo) {
    const ceilingBrands = new Set(limitTo.brandIds || []);
    const ceilingModels = new Set(limitTo.modelIds || []);

    const overBrand = wantedBrands.some((id) => !ceilingBrands.has(id));
    const overModel = modelRows.some(
      (m) => !ceilingBrands.has(m.brandId) && !ceilingModels.has(m.id)
    );
    if (overBrand || overModel) {
      throw new ForbiddenError('فقط می‌توانید از برندها و مدل‌های خودتان به زیرنمایندگی بدهید');
    }
  }

  await prisma.$transaction([
    prisma.brandAccess.deleteMany({ where: { userId } }),
    prisma.modelAccess.deleteMany({ where: { userId } }),
    prisma.brandAccess.createMany({
      data: wantedBrands.map((brandId) => ({ userId, brandId })),
      skipDuplicates: true,
    }),
    prisma.modelAccess.createMany({
      data: wantedModels.map((carModelId) => ({ userId, carModelId })),
      skipDuplicates: true,
    }),
  ]);

  return wantedBrands.length + wantedModels.length;
}

/**
 * The check the listing form makes: a whole-brand grant, or this very model.
 */
async function assertMayPost({ userId, carModelId }) {
  const model = await prisma.carModel.findUnique({
    where: { id: carModelId },
    select: { id: true, brandId: true, brand: { select: { name: true } } },
  });
  if (!model) return; // The catalogue check upstream reports this properly.

  const [brandGrant, modelGrant] = await Promise.all([
    prisma.brandAccess.count({ where: { userId, brandId: model.brandId } }),
    prisma.modelAccess.count({ where: { userId, carModelId: model.id } }),
  ]);

  if (!brandGrant && !modelGrant) {
    // Names the brand, because "you may not post this" without saying which
    // sends the reader to support to ask a question the message could answer.
    throw new ForbiddenError(
      `حساب شما اجازه‌ی ثبت آگهی برای «${model.brand.name}» را ندارد. برای درخواست خرید محدودیتی نیست.`
    );
  }
}

module.exports = { allowedSets, allowedBrandIds, brandChoices, setBrands, assertMayPost };
