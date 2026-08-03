const { Router } = require('express');
const Joi = require('joi');

const errorLogService = require('./errorLog.service');
const telegram = require('./telegram');
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
 * The developer's view of what is breaking.
 *
 * Behind the `settings` permission — the same gate as the seat price and the
 * SMS switch — because a stack trace names internal paths and a message can
 * quote user input. Support staff have no business reading either.
 */
router.use(authenticate, requirePasswordChanged, requirePermission('settings'));

/**
 * @openapi
 * /errors:
 *   get:
 *     tags: [Errors]
 *     summary: Recorded errors, most recently seen first
 */
router.get(
  '/',
  validate({
    query: Joi.object({
      resolved: Joi.boolean().default(false),
      skip: Joi.number().integer().min(0).default(0),
      take: Joi.number().integer().min(1).max(200).default(50),
    }),
  }),
  asyncHandler(async (req, res) => success(res, await errorLogService.list(req.query)))
);

/**
 * @openapi
 * /errors/{id}:
 *   get:
 *     tags: [Errors]
 *     summary: One error with its stack and a suggested first step
 */
router.get(
  '/:id',
  validate({ params: Joi.object({ id: Joi.string().trim().max(40).required() }) }),
  asyncHandler(async (req, res) => success(res, await errorLogService.get(req.params.id)))
);

/**
 * @openapi
 * /errors/{id}/resolve:
 *   post:
 *     tags: [Errors]
 *     summary: Mark as handled
 *     description: >
 *       It comes back automatically if the same error happens again — being
 *       marked resolved is a claim about the fix, and the system checks it.
 */
router.post(
  '/:id/resolve',
  validate({
    params: Joi.object({ id: Joi.string().trim().max(40).required() }),
    body: Joi.object({ note: Joi.string().trim().max(500).allow('', null) }),
  }),
  asyncHandler(async (req, res) =>
    success(res, await errorLogService.resolve(req.params.id, req.body.note))
  )
);

/**
 * @openapi
 * /errors/test-alert:
 *   post:
 *     tags: [Errors]
 *     summary: Send a test message to Telegram
 *     description: >
 *       An alerting channel nobody has tested is not an alerting channel. This
 *       proves the token and chat id are right, from the machine that will
 *       actually be sending.
 */
router.post(
  '/test-alert',
  asyncHandler(async (_req, res) => {
    if (!telegram.enabled()) {
      return success(res, {
        sent: false,
        reason: 'TELEGRAM_BOT_TOKEN یا TELEGRAM_CHAT_ID در .env تنظیم نشده است.',
      });
    }
    telegram.reset();
    const sent = await telegram.send({
      level: 'info',
      title: 'پیام آزمایشی',
      detail: 'اگر این پیام را می‌بینید، هشدارهای سامانه به همین گفت‌وگو می‌رسند.',
      help: 'کاری لازم نیست — این فقط یک آزمایش بود.',
    });
    return success(res, {
      sent,
      reason: sent ? null : 'تلگرام پاسخ نداد. توکن، chat id و دسترسی شبکه‌ی سرور را بررسی کنید.',
    });
  })
);

module.exports = router;
