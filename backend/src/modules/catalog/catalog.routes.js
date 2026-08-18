const { Router } = require('express');

const catalogRepository = require('./catalog.repository');
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
  asyncHandler(async (_req, res) => {
    const [brands, colors] = await Promise.all([
      catalogRepository.listBrands(),
      catalogRepository.listColors(),
    ]);
    return success(res, { brands, colors });
  })
);

module.exports = router;
