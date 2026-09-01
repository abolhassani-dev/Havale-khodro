const { Router } = require('express');
const Joi = require('joi');

const catalogRepository = require('./catalog.repository');
const authRepository = require('../auth/auth.repository');
const validate = require('../../middlewares/validate');
const asyncHandler = require('../../utils/asyncHandler');
const { success, created } = require('../../responses/apiResponse');
const { requirePermission } = require('../../middlewares/auth');
const { NotFoundError } = require('../../errors/AppError');

/**
 * Editing the car catalogue.
 *
 * The people who know the market are the ones who should be maintaining this,
 * and until now adding a model meant asking a developer. Everything here is
 * ordinary CRUD with one deliberate omission: nothing can be deleted.
 *
 * A model that has been used is referenced by listings, reveal records and
 * violation reports. Deleting it would take that history with it — so "remove a
 * car" means deactivate: no new listings can use it, every existing listing
 * stays exactly as it was.
 */
const router = Router();

router.use(requirePermission('catalog'));

const idParam = Joi.object({ id: Joi.string().trim().max(40).required() });
const name = Joi.string().trim().min(1).max(120);
const slug = Joi.string()
  .trim()
  .lowercase()
  .pattern(/^[a-z0-9-]+$/)
  .max(60);
const sortOrder = Joi.number().integer().min(0).max(9999);
const isActive = Joi.boolean();
// The body shape the خودرو market draws and filters by. Settable only here:
// the classifier fills blanks at boot, this is where a person overrules it.
const bodyType = Joi.string().valid('SEDAN', 'HATCHBACK', 'SUV', 'PICKUP');

/** Records who changed the catalogue, so an unexpected change can be traced. */
async function log(actor, summary) {
  return authRepository.recordActivity({
    userId: actor.id,
    action: 'CATALOG_CHANGED',
    targetType: 'CATALOG',
    summary,
  });
}

/**
 * @openapi
 * /admin/catalog:
 *   get:
 *     tags: [Catalog]
 *     summary: The whole catalogue including deactivated entries
 *     description: >
 *       Unlike the agent-facing `/catalog`, this includes inactive rows — you
 *       cannot bring back something you cannot see.
 */
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const [companies, brands, colors] = await Promise.all([
      catalogRepository.listAllCompanies(),
      catalogRepository.listAllBrands(),
      catalogRepository.listAllColors(),
    ]);
    return success(res, { companies, brands, colors });
  })
);

/**
 * @openapi
 * /admin/catalog/brands/{id}/models:
 *   get:
 *     tags: [Catalog]
 *     summary: The models of one brand, including deactivated ones
 *     description: >
 *       Fetched when a brand is opened rather than sent with the catalogue.
 *       Two thousand models in one response is a page nobody can use and a
 *       payload nobody should pay for.
 */
router.get(
  '/brands/:id/models',
  validate({ params: idParam }),
  asyncHandler(async (req, res) =>
    success(res, { models: await catalogRepository.listModelsOfBrand(req.params.id) }))
);

/**
 * @openapi
 * /admin/catalog/models/{id}/usage:
 *   get:
 *     tags: [Catalog]
 *     summary: How many listings already use this model
 *     description: Shown before deactivating, so the effect is not a surprise.
 */
router.get(
  '/models/:id/usage',
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const havales = await catalogRepository.countHavalesForModel(req.params.id);
    return success(res, { havales });
  })
);

// ── companies ───────────────────────────────────────────────────────────────

router.post(
  '/companies',
  validate({
    body: Joi.object({
      name: name.required(),
      slug: slug.required(),
      sortOrder: sortOrder.default(0),
    }),
  }),
  asyncHandler(async (req, res) => {
    const company = await catalogRepository.createCompany(req.body);
    await log(req.user, `company:${company.name}`);
    return created(res, company);
  })
);

router.patch(
  '/companies/:id',
  validate({ params: idParam, body: Joi.object({ name, sortOrder, isActive }).min(1) }),
  asyncHandler(async (req, res) => {
    const company = await catalogRepository.updateCompany(req.params.id, req.body);
    await log(req.user, `company:${company.name}`);
    return success(res, company);
  })
);

// ── brands ──────────────────────────────────────────────────────────────────

router.post(
  '/brands',
  validate({
    body: Joi.object({
      // Optional, because most brands have no company and never will. Insisting
      // on one would mean inventing an answer for برندی که شرکتش را نمی‌دانیم,
      // which is exactly the guess this design avoids.
      companyId: Joi.string().trim().max(40).allow(null, ''),
      name: name.required(),
      slug: slug.required(),
      sortOrder: sortOrder.default(0),
    }),
  }),
  asyncHandler(async (req, res) => {
    if (req.body.companyId) {
      const company = await catalogRepository.findCompany(req.body.companyId);
      if (!company) throw new NotFoundError('شرکت');
    } else {
      req.body.companyId = null;
    }

    const brand = await catalogRepository.createBrand(req.body);
    await log(req.user, `brand:${brand.name}`);
    return created(res, brand);
  })
);

router.patch(
  '/brands/:id',
  validate({
    params: idParam,
    // `companyId` is here so a grouping can be corrected in one click. It will
    // be wrong sometimes — nobody knows which company builds all 186 brands —
    // and a wrong grouping that cannot be fixed is the thing to avoid. Empty
    // string means «دسته‌بندی‌نشده», which is a legitimate destination and not
    // a failure to answer.
    body: Joi.object({
      name,
      sortOrder,
      isActive,
      companyId: Joi.string().trim().max(40).allow(null, ''),
    }).min(1),
  }),
  asyncHandler(async (req, res) => {
    if (req.body.companyId !== undefined) {
      if (req.body.companyId) {
        const company = await catalogRepository.findCompany(req.body.companyId);
        if (!company) throw new NotFoundError('شرکت');
      } else {
        req.body.companyId = null;
      }
    }

    const brand = await catalogRepository.updateBrand(req.params.id, req.body);
    await log(req.user, `brand:${brand.name}`);
    return success(res, brand);
  })
);

// ── models ──────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /admin/catalog/models:
 *   post:
 *     tags: [Catalog]
 *     summary: Add a car model
 */
router.post(
  '/models',
  validate({
    body: Joi.object({
      brandId: Joi.string().trim().max(40).required(),
      name: name.required(),
      sortOrder: sortOrder.default(0),
    }),
  }),
  asyncHandler(async (req, res) => {
    const brand = await catalogRepository.findBrand(req.body.brandId);
    if (!brand) throw new NotFoundError('برند');

    const model = await catalogRepository.createModel(req.body);
    await log(req.user, `model:${model.name}`);
    return created(res, model);
  })
);

/**
 * @openapi
 * /admin/catalog/models/{id}:
 *   patch:
 *     tags: [Catalog]
 *     summary: Rename, reorder, or retire a model
 *     description: >
 *       Setting `isActive: false` retires it — no new listing can use it, and
 *       every listing already posted with it stays exactly as it was, because a
 *       listing keeps its own copy of the name.
 */
router.patch(
  '/models/:id',
  validate({ params: idParam, body: Joi.object({ name, sortOrder, isActive, bodyType }).min(1) }),
  asyncHandler(async (req, res) => {
    const model = await catalogRepository.updateModel(req.params.id, req.body);
    await log(req.user, `model:${model.name}`);
    return success(res, model);
  })
);

// ── colours ─────────────────────────────────────────────────────────────────

router.post(
  '/colors',
  validate({ body: Joi.object({ name: name.required(), sortOrder: sortOrder.default(0) }) }),
  asyncHandler(async (req, res) => {
    const color = await catalogRepository.createColor(req.body);
    await log(req.user, `color:${color.name}`);
    return created(res, color);
  })
);

router.patch(
  '/colors/:id',
  validate({ params: idParam, body: Joi.object({ name, sortOrder, isActive }).min(1) }),
  asyncHandler(async (req, res) => {
    const color = await catalogRepository.updateColor(req.params.id, req.body);
    await log(req.user, `color:${color.name}`);
    return success(res, color);
  })
);

module.exports = router;
