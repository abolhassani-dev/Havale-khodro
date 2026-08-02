const { Router } = require('express');
const Joi = require('joi');

const subscriptionService = require('./subscription.service');
const subscriptionRepository = require('./subscription.repository');
const validate = require('../../middlewares/validate');
const asyncHandler = require('../../utils/asyncHandler');
const { success, created } = require('../../responses/apiResponse');
const {
  authenticate,
  requirePasswordChanged,
  requireRole,
  requirePermission,
} = require('../../middlewares/auth');
const { ROLES } = require('../../constants/roles');
const { MESSAGES } = require('../../constants/messages');

const router = Router();

router.use(authenticate, requirePasswordChanged);

const agentOnly = requireRole(ROLES.AGENT);

/**
 * @openapi
 * /subscriptions/me:
 *   get:
 *     tags: [Subscription]
 *     summary: The agent's own subscription, limits and history
 */
router.get(
  '/me',
  agentOnly,
  asyncHandler(async (req, res) => success(res, await subscriptionService.statusFor(req.user)))
);

/**
 * @openapi
 * /subscriptions/invoice:
 *   get:
 *     tags: [Subscription]
 *     summary: What this account owes for the coming period
 *     description: >
 *       Own plan plus one seat charge per active sub-agency. Recomputed from the
 *       live count each time rather than stored, so it cannot drift.
 */
router.get(
  '/invoice',
  agentOnly,
  asyncHandler(async (req, res) => success(res, await subscriptionService.invoiceFor(req.user)))
);

/**
 * @openapi
 * /subscriptions/seats:
 *   get:
 *     tags: [Subscription]
 *     summary: Capacity bought, used and available
 */
router.get(
  '/seats',
  agentOnly,
  asyncHandler(async (req, res) => success(res, await subscriptionService.seatSummary(req.user)))
);

/**
 * @openapi
 * /subscriptions/seat-orders:
 *   post:
 *     tags: [Subscription]
 *     summary: Ask to buy capacity
 *     description: >
 *       Capacity is prepaid, so this creates a request an admin confirms after
 *       the transfer arrives. Paying up front is what stops a reseller running
 *       fifty sub-agencies all month and suspending them before the bill.
 */
router.post(
  '/seat-orders',
  agentOnly,
  validate({
    body: Joi.object({
      seats: Joi.number().integer().min(1).max(500).required(),
      note: Joi.string().trim().max(500).allow('', null),
    }),
  }),
  asyncHandler(async (req, res) => {
    const order = await subscriptionService.requestSeats({
      user: req.user,
      seats: req.body.seats,
      note: req.body.note,
    });
    return created(res, order, MESSAGES.SEAT.ORDER_CREATED);
  })
);

/**
 * @openapi
 * /subscriptions/seat-orders:
 *   get:
 *     tags: [Subscription]
 *     summary: The reseller's own capacity orders
 */
router.get(
  '/seat-orders',
  agentOnly,
  asyncHandler(async (req, res) =>
    success(res, await subscriptionService.listSeatOrders({ buyerId: req.user.id }))
  )
);

// ── admin ───────────────────────────────────────────────────────────────────
//
// Guarded by the `subscriptions` permission, which the super admin and finance
// hold and support does not (blueprint 11.12). Support answering a billing
// question must not be able to hand out a free month.

/**
 * @openapi
 * /subscriptions/plans:
 *   get:
 *     tags: [Subscription]
 *     summary: Available plans
 */
router.get(
  '/plans',
  asyncHandler(async (_req, res) => {
    const plans = await subscriptionRepository.listPlans();
    return success(res, plans.map(subscriptionService.planSummary));
  })
);

/**
 * @openapi
 * /subscriptions/grant:
 *   post:
 *     tags: [Subscription]
 *     summary: Grant or renew a subscription after a payment is confirmed
 *     description: >
 *       Payment in phase one is a bank transfer confirmed by hand. The new period
 *       runs from now, not from the old expiry date — an agency that renews late
 *       has been without service in between and should not be charged for it.
 */
router.post(
  '/grant',
  requirePermission('subscriptions'),
  validate({
    body: Joi.object({
      userId: Joi.string().trim().max(40).required(),
      planId: Joi.string().trim().max(40).required(),
      note: Joi.string().trim().max(500).allow('', null),
    }),
  }),
  asyncHandler(async (req, res) => {
    const result = await subscriptionService.grant({
      actor: req.user,
      userId: req.body.userId,
      planId: req.body.planId,
      note: req.body.note,
    });
    return created(res, result, MESSAGES.SUBSCRIPTION.GRANTED);
  })
);

/**
 * @openapi
 * /subscriptions/seat-orders/pending:
 *   get:
 *     tags: [Subscription]
 *     summary: Capacity orders waiting for a payment to be confirmed
 */
router.get(
  '/seat-orders/pending',
  requirePermission('seats'),
  asyncHandler(async (_req, res) =>
    success(res, await subscriptionService.listSeatOrders({ status: 'PENDING' }))
  )
);

/**
 * @openapi
 * /subscriptions/seat-orders/{id}/review:
 *   post:
 *     tags: [Subscription]
 *     summary: Confirm or reject a capacity order
 */
router.post(
  '/seat-orders/:id/review',
  requirePermission('seats'),
  validate({
    params: Joi.object({ id: Joi.string().trim().max(40).required() }),
    body: Joi.object({
      approve: Joi.boolean().required(),
      note: Joi.string().trim().max(500).allow('', null),
    }),
  }),
  asyncHandler(async (req, res) => {
    const order = await subscriptionService.reviewSeatOrder({
      actor: req.user,
      orderId: req.params.id,
      approve: req.body.approve,
      note: req.body.note,
    });
    return success(res, order);
  })
);

module.exports = router;
