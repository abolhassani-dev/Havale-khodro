const { Router } = require('express');
const Joi = require('joi');

const securityService = require('./security.service');
const { RULE_LABELS } = require('./threat.rules');
const validate = require('../../middlewares/validate');
const asyncHandler = require('../../utils/asyncHandler');
const { success } = require('../../responses/apiResponse');
const { BadRequestError } = require('../../errors/AppError');
const { refreshBlockList } = require('../../middlewares/blockedIp');
const {
  authenticate,
  requirePasswordChanged,
  requirePermission,
} = require('../../middlewares/auth');

const router = Router();

/**
 * The intrusion log.
 *
 * Behind `errorLog`, which the permissions table gives to the owner alone —
 * the same gate as the technical log, and for a stronger version of the same
 * reason. These rows name the addresses attacking the system and quote what
 * they sent; handing that to every administrator is handing out a map.
 */
router.use(authenticate, requirePasswordChanged, requirePermission('errorLog'));

/**
 * @openapi
 * /security/events:
 *   get:
 *     tags: [Security]
 *     summary: Recorded intrusion attempts, most recently active first
 */
router.get(
  '/events',
  validate({
    query: Joi.object({
      resolved: Joi.boolean().default(false),
      rule: Joi.string().trim().valid(...Object.keys(RULE_LABELS)),
      severity: Joi.string().valid('high', 'medium', 'low'),
      ip: Joi.string().trim().max(64),
      skip: Joi.number().integer().min(0).default(0),
      take: Joi.number().integer().min(1).max(200).default(50),
    }),
  }),
  asyncHandler(async (req, res) => {
    const [list, summary, blocked] = await Promise.all([
      securityService.list(req.query),
      securityService.summary(),
      securityService.blockedList(),
    ]);
    return success(res, {
      ...list,
      summary,
      blocked,
      // The names come from the server so the panel invents none of them, and
      // so a rule added tomorrow appears in the filter the same day.
      rules: Object.entries(RULE_LABELS).map(([key, label]) => ({ key, label })),
      // Shown on the screen beside the block button. Nobody should have to
      // guess which address is their own before closing a door.
      yourIp: req.ip,
    });
  })
);

/**
 * @openapi
 * /security/events/{id}:
 *   get:
 *     tags: [Security]
 *     summary: One event, with everything else that address has tried
 */
router.get(
  '/events/:id',
  validate({ params: Joi.object({ id: Joi.string().trim().max(40).required() }) }),
  asyncHandler(async (req, res) => success(res, await securityService.get(req.params.id)))
);

/**
 * @openapi
 * /security/events/{id}/resolve:
 *   post:
 *     tags: [Security]
 *     summary: Mark as reviewed
 *     description: It comes back on its own if the same address tries again.
 */
router.post(
  '/events/:id/resolve',
  validate({
    params: Joi.object({ id: Joi.string().trim().max(40).required() }),
    body: Joi.object({ note: Joi.string().trim().max(500).allow('', null) }),
  }),
  asyncHandler(async (req, res) =>
    success(res, await securityService.resolve(req.params.id, req.body.note))
  )
);

/**
 * @openapi
 * /security/blocks:
 *   post:
 *     tags: [Security]
 *     summary: Close the door on one address
 */
router.post(
  '/blocks',
  validate({
    body: Joi.object({
      ip: Joi.string().trim().max(64).required(),
      reason: Joi.string().trim().max(200).allow('', null),
      // Open-ended is allowed but not the default: an address is rented, and
      // the person on it next year is somebody else.
      days: Joi.number().integer().min(1).max(3650).allow(null),
    }),
  }),
  asyncHandler(async (req, res) => {
    // Refusing to lock the door on the person holding the key. Blocking runs
    // before authentication — there is no way for the middleware to recognise
    // the owner and let them through — so the only safe moment to catch this
    // is here, before it is written.
    if (req.body.ip === req.ip) {
      throw new BadRequestError('این آی‌پی خودِ شماست — بستنش شما را از پنل بیرون می‌اندازد.');
    }

    const row = await securityService.block({
      ip: req.body.ip,
      reason: req.body.reason,
      days: req.body.days,
      byUserId: req.user.id,
    });
    // The middleware reads a cached set that refreshes on a timer; without
    // this the block would appear to do nothing for up to a minute, which
    // reads as a broken button.
    await refreshBlockList();
    return success(res, row);
  })
);

/**
 * @openapi
 * /security/blocks/{ip}:
 *   delete:
 *     tags: [Security]
 *     summary: Open it again
 */
router.delete(
  '/blocks/:ip',
  validate({ params: Joi.object({ ip: Joi.string().trim().max(64).required() }) }),
  asyncHandler(async (req, res) => {
    await securityService.unblock(req.params.ip);
    await refreshBlockList();
    return success(res, { ip: req.params.ip, blocked: false });
  })
);

module.exports = router;
