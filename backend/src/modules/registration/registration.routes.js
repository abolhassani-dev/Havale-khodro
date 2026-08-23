const { Router } = require('express');

const registrationService = require('./registration.service');
const schema = require('./registration.validator');
const validate = require('../../middlewares/validate');
const asyncHandler = require('../../utils/asyncHandler');
const { success, created } = require('../../responses/apiResponse');
const { authenticate, requirePasswordChanged, requireRole } = require('../../middlewares/auth');
const { attachAccess, requireActiveSubscription } = require('../../middlewares/access');
const { ROLES } = require('../../constants/roles');
const { MESSAGES } = require('../../constants/messages');

const router = Router();

/**
 * The ثبت‌نامی market.
 *
 * Every route below is for agencies and needs a live session, a password the
 * account actually chose, and its entitlement resolved. Applied once at the top
 * rather than per route: a route added later inherits the protection instead of
 * needing somebody to remember it.
 *
 * The subscription check is *not* here. An expired agency still browses the
 * market — what it loses is the identity and contact details inside each
 * result, and the ability to post — which follows the access table, clause 7.
 */
router.use(authenticate, requirePasswordChanged, requireRole(ROLES.AGENT), attachAccess);

/**
 * @openapi
 * /registrations:
 *   get:
 *     tags: [Registration]
 *     summary: Browse capacity offers and requests
 */
router.get(
  '/',
  validate(schema.list),
  asyncHandler(async (req, res) =>
    success(
      res,
      await registrationService.list({ user: req.user, access: req.access, filters: req.query })
    )
  )
);

/**
 * @openapi
 * /registrations/mine:
 *   get:
 *     tags: [Registration]
 *     summary: The agency's own advertisements, and its sub-agencies'
 */
router.get(
  '/mine',
  validate(schema.own),
  asyncHandler(async (req, res) =>
    success(res, await registrationService.listOwn({ user: req.user, filters: req.query }))
  )
);

/**
 * @openapi
 * /registrations:
 *   post:
 *     tags: [Registration]
 *     summary: Announce capacity, or ask for it
 *     description: >
 *       Announcing capacity is refused for a brand this account was not given.
 *       Asking for capacity is not, because an agency buys whatever its own
 *       customer walked in asking for.
 */
router.post(
  '/',
  requireActiveSubscription,
  validate(schema.create),
  asyncHandler(async (req, res) => {
    const row = await registrationService.create({ user: req.user, payload: req.body });
    return created(res, row, MESSAGES.HAVALE.CREATED);
  })
);

/**
 * @openapi
 * /registrations/{id}:
 *   get:
 *     tags: [Registration]
 *     summary: One advertisement, masked unless its contact was revealed
 */
router.get(
  '/:id',
  validate(schema.byId),
  asyncHandler(async (req, res) =>
    success(
      res,
      await registrationService.getById({ user: req.user, access: req.access, id: req.params.id })
    )
  )
);

/**
 * @openapi
 * /registrations/{id}:
 *   patch:
 *     tags: [Registration]
 *     summary: Edit an advertisement that is still live
 */
router.patch(
  '/:id',
  requireActiveSubscription,
  validate(schema.update),
  asyncHandler(async (req, res) =>
    success(
      res,
      await registrationService.update({ user: req.user, id: req.params.id, payload: req.body }),
      MESSAGES.HAVALE.UPDATED
    )
  )
);

/**
 * @openapi
 * /registrations/{id}/renew:
 *   post:
 *     tags: [Registration]
 *     summary: Give it a fresh window
 */
router.post(
  '/:id/renew',
  requireActiveSubscription,
  validate(schema.byId),
  asyncHandler(async (req, res) =>
    success(
      res,
      await registrationService.renew({
        user: req.user,
        id: req.params.id,
        registerDeadline: req.body?.registerDeadline,
      }),
      MESSAGES.HAVALE.RENEWED
    )
  )
);

/**
 * @openapi
 * /registrations/{id}/fulfill:
 *   post:
 *     tags: [Registration]
 *     summary: Mark the capacity as handed over, which closes the advertisement
 */
router.post(
  '/:id/fulfill',
  validate(schema.byId),
  asyncHandler(async (req, res) =>
    success(
      res,
      await registrationService.markFulfilled({ user: req.user, id: req.params.id }),
      MESSAGES.HAVALE.FULFILLED
    )
  )
);

/**
 * @openapi
 * /registrations/{id}:
 *   delete:
 *     tags: [Registration]
 *     summary: Take it out of the market — the row and its history stay
 */
router.delete(
  '/:id',
  validate(schema.byId),
  asyncHandler(async (req, res) =>
    success(
      res,
      await registrationService.remove({ user: req.user, id: req.params.id }),
      MESSAGES.HAVALE.DELETED
    )
  )
);

/**
 * @openapi
 * /registrations/{id}/reveal:
 *   post:
 *     tags: [Registration]
 *     summary: Spend one view on the advertiser's contact details
 *     description: >
 *       The allowance is the account's single one, shared with the حواله
 *       market: one subscription, one budget.
 */
router.post(
  '/:id/reveal',
  requireActiveSubscription,
  validate(schema.byId),
  asyncHandler(async (req, res) =>
    success(
      res,
      await registrationService.reveal({
        user: req.user,
        access: req.access,
        id: req.params.id,
        ip: req.ip,
      }),
      MESSAGES.HAVALE.REVEALED
    )
  )
);

module.exports = router;
