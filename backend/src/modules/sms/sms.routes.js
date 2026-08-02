const { Router } = require('express');
const Joi = require('joi');

const smsService = require('./sms.service');
const smsRepository = require('./sms.repository');
const validate = require('../../middlewares/validate');
const asyncHandler = require('../../utils/asyncHandler');
const { success } = require('../../responses/apiResponse');
const { authenticate, requirePasswordChanged, requirePermission } = require('../../middlewares/auth');

const router = Router();

/**
 * The outbox, and the switch.
 *
 * Restricted to the `settings` permission, which only the super admin holds:
 * every message the system sends is addressed to a mobile number, so this view
 * is a list of phone numbers and must not be open to support staff (blueprint
 * 11.12).
 */
router.use(authenticate, requirePasswordChanged, requirePermission('settings'));

/**
 * @openapi
 * /sms/status:
 *   get:
 *     tags: [SMS]
 *     summary: Whether delivery is switched on
 */
router.get(
  '/status',
  asyncHandler(async (_req, res) => {
    return success(res, { enabled: await smsService.isEnabled() });
  })
);

/**
 * @openapi
 * /sms/status:
 *   put:
 *     tags: [SMS]
 *     summary: Switch delivery on or off
 *     description: >
 *       Takes effect immediately, without a deploy — so the panel can be
 *       activated the hour it is bought.
 */
router.put(
  '/status',
  validate({ body: Joi.object({ enabled: Joi.boolean().required() }) }),
  asyncHandler(async (req, res) => {
    return success(res, await smsService.setEnabled(req.body.enabled));
  })
);

/**
 * @openapi
 * /sms/outbox:
 *   get:
 *     tags: [SMS]
 *     summary: Recent messages, including the ones delivery was switched off for
 *     description: >
 *       With delivery off, every message is still rendered and stored. This is
 *       what makes the notification path demonstrable before a panel exists.
 */
router.get(
  '/outbox',
  validate({ query: Joi.object({ limit: Joi.number().integer().min(1).max(200).default(50) }) }),
  asyncHandler(async (req, res) => {
    return success(res, await smsRepository.listRecent({ take: req.query.limit }));
  })
);

module.exports = router;
