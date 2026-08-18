const { Router } = require('express');

const catalogRepository = require('./catalog.repository');
const brandAccess = require('./brandAccess.service');
const asyncHandler = require('../../utils/asyncHandler');
const { success } = require('../../responses/apiResponse');
const { authenticate, requirePasswordChanged } = require('../../middlewares/auth');

const router = Router();

router.use(authenticate, requirePasswordChanged);

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
  asyncHandler(async (req, res) => {
    const [brands, colors, allowed] = await Promise.all([
      catalogRepository.listBrands(),
      catalogRepository.listColors(),
      brandAccess.allowedBrandIds(req.user.id),
    ]);

    // Every brand, each marked. Not a filtered list: the search filters use
    // this same catalogue, and an agency must be able to search the whole
    // market even though it may only post under part of it. The listing form
    // is what narrows itself, using `canPost`.
    const on = new Set(allowed);
    return success(
      res,
      { brands: brands.map((b) => ({ ...b, canPost: on.has(b.id) })), colors }
    );
  })
);

module.exports = router;
