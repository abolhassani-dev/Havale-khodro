const { prisma } = require('../../config/database');
const { ForbiddenError, BadRequestError } = require('../../errors/AppError');

/**
 * Which brands an account may post under.
 *
 * The rule in one sentence: an agency can *see* the whole market and can ask to
 * buy anything, but may only *offer* the brands it was given. That is how a
 * main agency divides work between twenty sub-agencies — one for Iran Khodro
 * products, one for Saipa — without any of them losing sight of the market they
 * are trading in.
 *
 * Three consequences follow, and each is load-bearing:
 *
 *   Searching and viewing are untouched. This is a division of labour, not a
 *   wall; an agency that cannot see a listing cannot broker it either.
 *
 *   A purchase request is untouched. Wanting a car is not the same as dealing
 *   in it, and a sub-agency that handles Peugeot still buys whatever its
 *   customer walked in asking for.
 *
 *   No rows means nothing, not everything. The empty set is the safe default
 *   for an account somebody forgot to configure — which is why brand access is
 *   asked for when an agency is created rather than applied to it afterwards.
 */

/** The brand ids this account may post under. Empty means none. */
async function allowedBrandIds(userId) {
  const rows = await prisma.brandAccess.findMany({
    where: { userId },
    select: { brandId: true },
  });
  return rows.map((r) => r.brandId);
}

/**
 * The same, as the picker needs it: every active brand, each flagged.
 *
 * One query rather than one per brand, and it returns the brands themselves so
 * a caller never has to fetch the catalogue separately and join by hand.
 */
async function brandChoices(userId) {
  const [brands, allowed] = await Promise.all([
    prisma.carBrand.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        logo: true,
        company: { select: { id: true, name: true } },
        _count: { select: { models: true } },
      },
    }),
    userId ? allowedBrandIds(userId) : [],
  ]);

  const on = new Set(allowed);
  return brands.map((b) => ({ ...b, allowed: on.has(b.id) }));
}

/**
 * Replaces an account's brand list.
 *
 * Delete-then-insert rather than a diff, inside one transaction. The set is at
 * most 186 rows and the diff would be more code for the same result — and a
 * half-applied change here is an agency that can suddenly post things nobody
 * chose, which is worth a transaction on its own.
 */
async function setBrands({ userId, brandIds, limitTo = null }) {
  const wanted = [...new Set(brandIds || [])];

  // Every id has to be a real, active brand. Otherwise a stale picker — or a
  // hand-made request — writes rows that point at nothing and read as access to
  // a brand that no longer exists.
  const real = await prisma.carBrand.findMany({
    where: { id: { in: wanted }, isActive: true },
    select: { id: true },
  });
  if (real.length !== wanted.length) throw new BadRequestError('برند نامعتبر انتخاب شده است');

  // A parent may only hand out what it holds. Checked here rather than in the
  // route so that no future caller can reach the write without it: the whole
  // value of letting a main agency configure its own sub-agencies is that it
  // cannot thereby grant itself more.
  if (limitTo) {
    const ceiling = new Set(limitTo);
    const over = wanted.filter((id) => !ceiling.has(id));
    if (over.length) {
      throw new ForbiddenError('فقط می‌توانید از برندهای خودتان به زیرنمایندگی بدهید');
    }
  }

  await prisma.$transaction([
    prisma.brandAccess.deleteMany({ where: { userId } }),
    prisma.brandAccess.createMany({
      data: wanted.map((brandId) => ({ userId, brandId })),
      skipDuplicates: true,
    }),
  ]);

  return wanted.length;
}

/**
 * The check the listing form makes.
 *
 * Asked with the model rather than the brand, because that is what a listing
 * carries — resolving it here means no caller has to remember that a model
 * implies a brand.
 */
async function assertMayPost({ userId, carModelId }) {
  const model = await prisma.carModel.findUnique({
    where: { id: carModelId },
    select: { brandId: true, brand: { select: { name: true } } },
  });
  if (!model) return; // The catalogue check upstream reports this properly.

  const allowed = await prisma.brandAccess.count({
    where: { userId, brandId: model.brandId },
  });

  if (!allowed) {
    // Names the brand, because "you may not post this" without saying which
    // brand sends the reader to support to ask a question the message could
    // have answered.
    throw new ForbiddenError(
      `حساب شما اجازه‌ی ثبت آگهی برای «${model.brand.name}» را ندارد. برای درخواست خرید محدودیتی نیست.`
    );
  }
}

module.exports = { allowedBrandIds, brandChoices, setBrands, assertMayPost };
