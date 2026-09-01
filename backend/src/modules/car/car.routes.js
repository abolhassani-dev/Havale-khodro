const { Router } = require('express');

const carService = require('./car.service');
const schema = require('./car.validator');
const validate = require('../../middlewares/validate');
const asyncHandler = require('../../utils/asyncHandler');
const { success, created } = require('../../responses/apiResponse');
const { authenticate, requirePasswordChanged, requireRole } = require('../../middlewares/auth');
const { attachAccess, requireActiveSubscription } = require('../../middlewares/access');
const { ROLES } = require('../../constants/roles');
const { MESSAGES } = require('../../constants/messages');

// Announces this market to the shared moderation desk — see
// modules/listing/marketRegistry.
require('./car.market');

const router = Router();

/**
 * The خودرو market.
 *
 * The same shape as its two siblings: everything needs a live session and the
 * entitlement resolved; the subscription check gates acting, not browsing.
 *
 * One deliberate difference: no brand-access check anywhere. A finished car
 * on the lot is anybody's to sell — the factory-allocation rule of the حواله
 * market has no meaning here, and the owner asked for the full catalogue.
 */
router.use(authenticate, requirePasswordChanged, requireRole(ROLES.AGENT), attachAccess);

/**
 * @openapi
 * /cars:
 *   get:
 *     tags: [Car]
 *     summary: Browse cars for sale and purchase requests
 */
router.get(
  '/',
  validate(schema.list),
  asyncHandler(async (req, res) =>
    success(res, await carService.list({ user: req.user, access: req.access, filters: req.query }))
  )
);

/**
 * @openapi
 * /cars/mine:
 *   get:
 *     tags: [Car]
 *     summary: The agency's own advertisements, and its sub-agencies'
 */
router.get(
  '/mine',
  validate(schema.own),
  asyncHandler(async (req, res) =>
    success(res, await carService.listOwn({ user: req.user, filters: req.query }))
  )
);

/**
 * @openapi
 * /cars:
 *   post:
 *     tags: [Car]
 *     summary: Post a car for sale, or ask for one
 */
router.post(
  '/',
  requireActiveSubscription,
  validate(schema.create),
  asyncHandler(async (req, res) => {
    const row = await carService.create({ user: req.user, payload: req.body });
    return created(res, row, MESSAGES.HAVALE.CREATED);
  })
);

/**
 * @openapi
 * /cars/{id}:
 *   get:
 *     tags: [Car]
 *     summary: One advertisement, masked unless its contact was revealed
 */
router.get(
  '/:id',
  validate(schema.byId),
  asyncHandler(async (req, res) =>
    success(res, await carService.getById({ user: req.user, access: req.access, id: req.params.id }))
  )
);

/**
 * @openapi
 * /cars/{id}:
 *   patch:
 *     tags: [Car]
 *     summary: Edit an advertisement that is still live
 */
router.patch(
  '/:id',
  requireActiveSubscription,
  validate(schema.update),
  asyncHandler(async (req, res) =>
    success(
      res,
      await carService.update({ user: req.user, id: req.params.id, payload: req.body }),
      MESSAGES.HAVALE.UPDATED
    )
  )
);

/**
 * @openapi
 * /cars/{id}/renew:
 *   post:
 *     tags: [Car]
 *     summary: Give it a fresh week
 */
router.post(
  '/:id/renew',
  requireActiveSubscription,
  validate(schema.byId),
  asyncHandler(async (req, res) =>
    success(res, await carService.renew({ user: req.user, id: req.params.id }), MESSAGES.HAVALE.RENEWED)
  )
);

/**
 * @openapi
 * /cars/{id}/fulfill:
 *   post:
 *     tags: [Car]
 *     summary: Mark it sold, which closes the advertisement
 */
router.post(
  '/:id/fulfill',
  validate(schema.byId),
  asyncHandler(async (req, res) =>
    success(
      res,
      await carService.markFulfilled({ user: req.user, id: req.params.id }),
      MESSAGES.HAVALE.FULFILLED
    )
  )
);

/**
 * @openapi
 * /cars/{id}:
 *   delete:
 *     tags: [Car]
 *     summary: Take it out of the market — the row and its history stay
 */
router.delete(
  '/:id',
  validate(schema.byId),
  asyncHandler(async (req, res) =>
    success(res, await carService.remove({ user: req.user, id: req.params.id }), MESSAGES.HAVALE.DELETED)
  )
);

/**
 * @openapi
 * /cars/{id}/reveal:
 *   post:
 *     tags: [Car]
 *     summary: Spend one view on the advertiser's contact details
 *     description: >
 *       The allowance is the account's single one, shared with the other
 *       markets — one subscription, one budget. The reveal also unlocks the
 *       photos and the description on this advertisement.
 */
router.post(
  '/:id/reveal',
  requireActiveSubscription,
  validate(schema.byId),
  asyncHandler(async (req, res) =>
    success(
      res,
      await carService.reveal({ user: req.user, access: req.access, id: req.params.id, ip: req.ip }),
      MESSAGES.HAVALE.REVEALED
    )
  )
);

module.exports = router;
