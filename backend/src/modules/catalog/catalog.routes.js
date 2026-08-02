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
 *     summary: Companies, brands, models and colours for the listing form
 *     description: >
 *       Open to expired subscriptions: the form is not the thing being sold, and
 *       an agency about to renew should be able to see what it will be able to
 *       post.
 */
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const [companies, colors] = await Promise.all([
      catalogRepository.listCompanies(),
      catalogRepository.listColors(),
    ]);
    return success(res, { companies, colors });
  })
);

module.exports = router;
