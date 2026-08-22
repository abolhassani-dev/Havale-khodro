const { Router } = require('express');

const catalogRepository = require('./catalog.repository');
const brandAccess = require('./brandAccess.service');
const asyncHandler = require('../../utils/asyncHandler');
const { success } = require('../../responses/apiResponse');
const { authenticate, requirePasswordChanged } = require('../../middlewares/auth');

const router = Router();

router.use(authenticate, requirePasswordChanged);

/**
 * Let the browser keep the catalogue for a couple of minutes.
 *
 * Brands, models and colours are opened by the search page and both listing
 * forms, and they change a few times a month — but every visit to those pages
 * fetched them again, so moving between «استعلام» and «ثبت حواله» paid for the
 * same payload twice a minute.
 *
 * `private` is not optional: this response carries the account's own posting
 * rights (`canPost`), so a shared cache holding one agency's copy for another
 * would be a real leak. Two minutes because an administrator who edits the
 * catalogue, or grants a brand, should see it take effect while they are still
 * looking at the screen.
 */
function cacheBriefly(req, res, next) {
  res.set('Cache-Control', 'private, max-age=120');
  return next();
}

/**
 * @openapi
 * /catalog:
 *   get:
 *     tags: [Catalog]
 *     summary: Brands, models and colours for the listing form
 *     description: >
 *       Open to expired subscriptions: the form is not the thing being sold, and
 *       an agency about to renew should be able to see what it will be able to
 *       post.
 */
router.get(
  '/',
  cacheBriefly,
  asyncHandler(async (req, res) => {
    const [brands, colors, allowed] = await Promise.all([
      catalogRepository.listBrands(),
      catalogRepository.listColors(),
      brandAccess.allowedSets(req.user.id),
    ]);

    // Every brand, each marked. Not a filtered list: the search filters use
    // this same catalogue, and an agency must be able to search the whole
    // market even though it may only post under part of it. The listing form
    // is what narrows itself, using the flags.
    //
    // `canPost` is the whole brand; `postableModelIds` on a brand are the
    // single-model grants inside it, so the form can offer that brand with
    // just those models in it.
    const on = new Set(allowed.brandIds);
    const perBrand = new Map();
    for (const g of allowed.modelGrants) {
      if (!perBrand.has(g.brandId)) perBrand.set(g.brandId, []);
      perBrand.get(g.brandId).push(g.id);
    }
    return success(res, {
      brands: brands.map((b) => ({
        ...b,
        canPost: on.has(b.id),
        postableModelIds: perBrand.get(b.id) || [],
      })),
      colors,
    });
  })
);

/**
 * @openapi
 * /catalog/brands/{id}/models:
 *   get:
 *     tags: [Catalog]
 *     summary: One brand's active models
 *     description: >
 *       Fetched when a brand is chosen rather than shipped with the catalogue —
 *       2044 models in one response was the heaviest payload in the product,
 *       paid on every visit to the search page and both listing forms.
 */
router.get(
  '/brands/:id/models',
  cacheBriefly,
  asyncHandler(async (req, res) =>
    success(res, { models: await catalogRepository.listActiveModelsOfBrand(req.params.id) }))
);

module.exports = router;
