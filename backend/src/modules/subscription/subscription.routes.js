const { Router } = require('express');
const Joi = require('joi');

const path = require('path');

const subscriptionService = require('./subscription.service');
const { makeUploader, discardOnFailure } = require('../../utils/uploads');
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

// One file, and it is the deposit slip. Its own folder so a receipt is never
// mistaken for a ticket attachment when somebody goes looking on disk.
const { upload: receiptUpload, dir: RECEIPTS_DIR } = makeUploader({
  subdir: 'receipts',
  maxFiles: 1,
  typeMessage: 'فیش واریزی باید عکس (JPG، PNG، WebP) یا فایل PDF باشد',
});

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
  // Multipart: the deposit slip rides with the request. Numbers arrive as
  // strings from a multipart body, so the schema converts rather than refuses.
  receiptUpload.single('receipt'),
  discardOnFailure,
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
      receiptFile: req.file,
    });
    return created(res, order, MESSAGES.SEAT.ORDER_CREATED);
  })
);

/**
 * @openapi
 * /subscriptions/seat-orders/{id}/receipt:
 *   get:
 *     tags: [Subscription]
 *     summary: The deposit slip attached to a capacity order
 *     description: Its buyer and reviewing staff only; anybody else gets 404.
 */
router.get(
  '/seat-orders/:id/receipt',
  validate({ params: Joi.object({ id: Joi.string().trim().max(40).required() }) }),
  asyncHandler(async (req, res) => {
    const receipt = await subscriptionService.seatOrderReceipt({
      user: req.user,
      orderId: req.params.id,
    });
    res.setHeader('Content-Type', receipt.mime);
    const disposition = receipt.mime.startsWith('image/') ? 'inline' : 'attachment';
    res.setHeader(
      'Content-Disposition',
      `${disposition}; filename*=UTF-8''${encodeURIComponent(receipt.name)}`
    );
    return res.sendFile(path.join(RECEIPTS_DIR, receipt.storedAs));
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

/**
 * @openapi
 * /subscriptions/seat-orders/alerts:
 *   get:
 *     tags: [Subscription]
 *     summary: Capacity decisions the buyer has not yet dismissed
 */
router.get(
  '/seat-orders/alerts',
  agentOnly,
  asyncHandler(async (req, res) => success(res, await subscriptionService.seatOrderAlerts(req.user)))
);

/**
 * @openapi
 * /subscriptions/seat-orders/{id}/ack:
 *   post:
 *     tags: [Subscription]
 *     summary: Dismiss a decided capacity order's notification
 */
router.post(
  '/seat-orders/:id/ack',
  agentOnly,
  validate({ params: Joi.object({ id: Joi.string().trim().max(40).required() }) }),
  asyncHandler(async (req, res) =>
    success(res, await subscriptionService.acknowledgeSeatOrder({ user: req.user, orderId: req.params.id }))
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
 * /subscriptions/expiry:
 *   post:
 *     tags: [Subscription]
 *     summary: Move a subscription's end date to a named day
 *     description: >
 *       The other half of the billing conversation from /grant: «give them
 *       until the end of Mehr» — a settlement, a goodwill week, a period
 *       agreed off the price list. A live subscription keeps its plan and its
 *       allowances and only its end date moves; with nothing live there is
 *       nothing to take limits from, so a plan must be named.
 */
router.post(
  '/expiry',
  requirePermission('subscriptions'),
  validate({
    body: Joi.object({
      userId: Joi.string().trim().max(40).required(),
      expiresAt: Joi.date().iso().greater('now').required(),
      planId: Joi.string().trim().max(40).allow('', null),
      note: Joi.string().trim().max(500).allow('', null),
    }),
  }),
  asyncHandler(async (req, res) => {
    const result = await subscriptionService.setExpiry({
      actor: req.user,
      userId: req.body.userId,
      expiresAt: req.body.expiresAt,
      planId: req.body.planId || null,
      note: req.body.note,
    });
    return success(res, result, MESSAGES.SUBSCRIPTION.EXTENDED);
  })
);

/**
 * @openapi
 * /subscriptions/cancel:
 *   post:
 *     tags: [Subscription]
 *     summary: End a subscription now
 *     description: >
 *       The row is kept and marked cancelled — it is a period this agency
 *       had, and the history is what answers «why did their access stop on
 *       the ninth?» three months later.
 */
router.post(
  '/cancel',
  requirePermission('subscriptions'),
  validate({
    body: Joi.object({
      userId: Joi.string().trim().max(40).required(),
      note: Joi.string().trim().max(500).allow('', null),
    }),
  }),
  asyncHandler(async (req, res) => {
    const result = await subscriptionService.cancelFor({
      actor: req.user,
      userId: req.body.userId,
      note: req.body.note,
    });
    return success(res, result, MESSAGES.SUBSCRIPTION.CANCELLED);
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
