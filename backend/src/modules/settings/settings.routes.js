const { Router } = require('express');
const Joi = require('joi');

const settingsService = require('./settings.service');
const validate = require('../../middlewares/validate');
const asyncHandler = require('../../utils/asyncHandler');
const { success } = require('../../responses/apiResponse');
const {
  authenticate,
  requirePasswordChanged,
  requirePermission,
} = require('../../middlewares/auth');

const router = Router();

/**
 * Settings are super-admin only.
 *
 * The seat price and the SMS switch have direct financial and operational
 * consequences, and the three admin roles exist precisely so that not everyone
 * with a login can reach them (blueprint 11.12).
 */
router.use(authenticate, requirePasswordChanged, requirePermission('settings'));

/**
 * @openapi
 * /settings:
 *   get:
 *     tags: [Settings]
 *     summary: Every setting, with defaults filled in
 */
router.get(
  '/',
  asyncHandler(async (_req, res) => success(res, await settingsService.all()))
);

/**
 * @openapi
 * /settings/{key}:
 *   put:
 *     tags: [Settings]
 *     summary: Change one setting
 *     description: Takes effect immediately, without a deploy.
 */
router.put(
  '/:key',
  validate({
    params: Joi.object({
      // Only declared keys are writable, so a typo cannot quietly create a
      // setting nothing reads.
      key: Joi.string()
        .valid(...Object.keys(settingsService.SETTINGS))
        .required(),
    }),
    body: Joi.object({
      value: Joi.alternatives(Joi.boolean(), Joi.number(), Joi.string()).required(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const value = await settingsService.set(req.params.key, req.body.value);
    return success(res, { key: req.params.key, value: String(value) });
  })
);

module.exports = router;
