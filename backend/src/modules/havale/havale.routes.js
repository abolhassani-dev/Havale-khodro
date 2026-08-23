const { Router } = require('express');

const controller = require('./havale.controller');
const schema = require('./havale.validator');
const validate = require('../../middlewares/validate');
const { authenticate, requirePasswordChanged, requireRole } = require('../../middlewares/auth');
const { attachAccess, requireActiveSubscription } = require('../../middlewares/access');
const { ROLES } = require('../../constants/roles');

// Announces this market to the shared moderation desk — see
// modules/listing/marketRegistry.
require('./havale.market');

const router = Router();

/**
 * Every route below is for agents and requires a live session, a password the
 * account has actually chosen, and its current entitlement resolved.
 *
 * Applying these once at the top rather than per route is deliberate: a route
 * added later inherits the protection instead of needing someone to remember it.
 * The subscription check is *not* here, because an expired agency still browses
 * the list — it is added per route, following the access table in clause 7.
 */
router.use(authenticate, requirePasswordChanged, requireRole(ROLES.AGENT), attachAccess);

/**
 * @openapi
 * /havales:
 *   get:
 *     tags: [Havale]
 *     summary: Browse listings
 *     description: >
 *       Open to expired subscriptions as well. What an expired subscription loses
 *       is the agency code, the city and the contact details inside each result —
 *       those are removed on the server, not hidden by the interface.
 *     responses:
 *       200: { description: A page of listings }
 */
router.get('/', validate(schema.list), controller.list);

/**
 * @openapi
 * /havales/mine:
 *   get:
 *     tags: [Havale]
 *     summary: The signed-in agent's own listings, including closed ones
 */
router.get('/mine', validate(schema.own), controller.listOwn);

/**
 * @openapi
 * /havales/reveal-usage:
 *   get:
 *     tags: [Havale]
 *     summary: How much of the reveal allowance is left
 */
router.get('/reveal-usage', controller.usage);

/**
 * @openapi
 * /havales:
 *   post:
 *     tags: [Havale]
 *     summary: Post a listing or a purchase request
 *     responses:
 *       201: { description: Created }
 *       403: { description: Subscription expired }
 */
router.post('/', requireActiveSubscription, validate(schema.create), controller.create);

/**
 * @openapi
 * /havales/{id}:
 *   get:
 *     tags: [Havale]
 *     summary: One listing, masked to the viewer's entitlement
 */
router.get('/:id', validate(schema.byId), controller.getById);

router.patch(
  '/:id',
  requireActiveSubscription,
  validate(schema.update),
  controller.update
);

/**
 * @openapi
 * /havales/{id}/renew:
 *   post:
 *     tags: [Havale]
 *     summary: Extend a listing
 *     description: >
 *       Ranks with posting, so it needs a live subscription: otherwise an agency
 *       that stopped paying could keep its listings alive indefinitely with a
 *       weekly click.
 */
router.post('/:id/renew', requireActiveSubscription, validate(schema.renew), controller.renew);

/**
 * @openapi
 * /havales/{id}/fulfill:
 *   post:
 *     tags: [Havale]
 *     summary: Mark as sold
 *     description: Allowed with an expired subscription — closing a listing is never blocked.
 */
router.post('/:id/fulfill', validate(schema.byId), controller.markFulfilled);

/**
 * @openapi
 * /havales/{id}:
 *   delete:
 *     tags: [Havale]
 *     summary: Remove a listing (soft delete)
 *     description: >
 *       Disappears from every agent's view but stays in the admin panel with its
 *       violation reports and reveal history, so deleting is not a way to escape
 *       a report.
 */
router.delete('/:id', validate(schema.byId), controller.remove);

/**
 * @openapi
 * /havales/{id}/reveal:
 *   post:
 *     tags: [Havale]
 *     summary: Show the coordinator's contact details
 *     description: >
 *       Records who looked, at which listing, when, from where, and the number as
 *       it read at that moment, then counts it against the daily and period caps.
 *       Opening the same listing again is free.
 *     responses:
 *       200: { description: Contact details }
 *       403: { description: Subscription expired, or cap reached }
 */
router.post('/:id/reveal', requireActiveSubscription, validate(schema.byId), controller.reveal);

module.exports = router;
