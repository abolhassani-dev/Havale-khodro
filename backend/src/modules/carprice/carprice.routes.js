const { Router } = require('express');

const carPriceService = require('./carprice.service');
const asyncHandler = require('../../utils/asyncHandler');
const { success } = require('../../responses/apiResponse');
const { authenticate, requirePasswordChanged, requireRole } = require('../../middlewares/auth');
const { ROLES } = require('../../constants/roles');
const { MESSAGES } = require('../../constants/messages');

const router = Router();

// Every signed-in agency, including one whose subscription has run out: the
// list is public information and a reason to come back, not something the
// subscription pays for.
router.use(authenticate, requirePasswordChanged, requireRole(ROLES.AGENT));

// The source's ids are short numbers; anything else is not an item.
const ID = ':id(\\d{1,12})';

/**
 * @openapi
 * /car-prices:
 *   get:
 *     tags: [CarPrices]
 *     summary: The market price list, as last fetched
 *     description: >
 *       Served from the hourly snapshot — never fetched on request. `updatedAt`
 *       is the last *successful* fetch; `stale` says it is older than the
 *       configured window. `watching` is this agency's starred ids.
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const [snapshot, watching] = await Promise.all([
      carPriceService.snapshot(),
      carPriceService.watchList(req.user),
    ]);
    // Small and personal (the stars), so no shared caching; the ETag Express
    // adds lets an unchanged list come back as a 304.
    res.set('Cache-Control', 'private, no-cache');
    return success(res, { ...snapshot, watching });
  })
);

/**
 * @openapi
 * /car-prices/watch/{id}:
 *   post:
 *     tags: [CarPrices]
 *     summary: Star a car — it joins «فهرست من»
 *   delete:
 *     tags: [CarPrices]
 *     summary: Unstar a car
 */
router.post(
  `/watch/${ID}`,
  asyncHandler(async (req, res) =>
    success(res, { watching: await carPriceService.watch(req.user, req.params.id) }, MESSAGES.CAR_PRICES.WATCHED)
  )
);

router.delete(
  `/watch/${ID}`,
  asyncHandler(async (req, res) =>
    success(res, { watching: await carPriceService.unwatch(req.user, req.params.id) }, MESSAGES.CAR_PRICES.UNWATCHED)
  )
);

module.exports = router;
