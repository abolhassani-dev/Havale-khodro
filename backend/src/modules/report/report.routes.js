const { Router } = require('express');
const Joi = require('joi');

const reportService = require('./report.service');
const validate = require('../../middlewares/validate');
const asyncHandler = require('../../utils/asyncHandler');
const { success, created } = require('../../responses/apiResponse');
const {
  authenticate,
  requirePasswordChanged,
  requireRole,
  requirePermission,
} = require('../../middlewares/auth');
const { attachAccess, requireActiveSubscription } = require('../../middlewares/access');
const { ROLES } = require('../../constants/roles');
const { MESSAGES } = require('../../constants/messages');
const { BadRequestError } = require('../../errors/AppError');
const {
  REPORT_REASON,
  REPORT_STATUS,
  DESCRIPTION_MIN_LENGTH,
} = require('../../constants/moderation');

const router = Router();

router.use(authenticate, requirePasswordChanged);

const idParam = Joi.object({ id: Joi.string().trim().max(40).required() });
const note = Joi.string().trim().max(1000).allow('', null);

/**
 * @openapi
 * /reports:
 *   post:
 *     tags: [Report]
 *     summary: Report a listing
 *     description: >
 *       Needs a live subscription, per the access table. Accepted for up to
 *       thirty days after the listing closes — including deleted listings, so
 *       that deleting is not a way to escape a report.
 *     responses:
 *       201: { description: Filed }
 *       400: { description: Own listing, too old, or contact not opened first }
 *       403: { description: Subscription expired or daily cap reached }
 *       409: { description: Already reported by this agency }
 */
router.post(
  '/',
  requireRole(ROLES.AGENT),
  attachAccess,
  requireActiveSubscription,
  validate({
    body: Joi.object({
      // The panel still says «havaleId», and will keep working when it starts
      // saying «listingId»: a report is filed against a listing in any market,
      // so both names are accepted and mapped to one below.
      listingId: Joi.string().trim().max(40),
      havaleId: Joi.string().trim().max(40),
      reason: Joi.string()
        .valid(...Object.values(REPORT_REASON))
        .required(),
      // Long enough to say something. A one-word report cannot be investigated
      // and cannot be answered.
      description: Joi.string().trim().min(DESCRIPTION_MIN_LENGTH).max(2000).required().messages({
        'string.min': `توضیح باید حداقل ${DESCRIPTION_MIN_LENGTH} کاراکتر باشد`,
      }),
    }),
  }),
  asyncHandler(async (req, res) => {
    const listingId = req.body.listingId || req.body.havaleId;
    if (!listingId) throw new BadRequestError('آگهی مشخص نشده است');

    const report = await reportService.create({ user: req.user, ...req.body, listingId });
    return created(res, report, MESSAGES.REPORT.FILED);
  })
);

/**
 * @openapi
 * /reports/against-me:
 *   get:
 *     tags: [Report]
 *     summary: Upheld reports against the signed-in agency, and its strike count
 *     description: >
 *       Without the reporter's identity: telling an advertiser who reported them
 *       turns the feature into a way to find out who to lean on.
 */
router.get(
  '/against-me',
  requireRole(ROLES.AGENT),
  asyncHandler(async (req, res) => success(res, await reportService.listAgainstMe(req.user)))
);

// ── moderation ──────────────────────────────────────────────────────────────

/**
 * @openapi
 * /reports:
 *   get:
 *     tags: [Report]
 *     summary: The moderation queue
 */
router.get(
  '/',
  requirePermission('reports'),
  validate({
    query: Joi.object({
      status: Joi.string().valid(...Object.values(REPORT_STATUS)),
      take: Joi.number().integer().min(1).max(200).default(50),
    }),
  }),
  asyncHandler(async (req, res) => success(res, await reportService.list(req.query)))
);

/**
 * @openapi
 * /reports/pending-approval:
 *   get:
 *     tags: [Report]
 *     summary: Suspensions waiting for the super admin
 *     description: >
 *       A third strike suspends an account, and support does not have that
 *       authority — those verdicts land here instead of taking effect.
 */
router.get(
  '/pending-approval',
  requirePermission('thirdStrike'),
  asyncHandler(async (_req, res) =>
    success(res, await reportService.list({ needsSuperApproval: true }))
  )
);

/**
 * @openapi
 * /reports/{id}/review:
 *   post:
 *     tags: [Report]
 *     summary: Decide a report
 *     description: >
 *       CONFIRMED takes the listing down and adds a strike to the advertiser.
 *       ABUSIVE adds a strike to the reporter instead — the feature has to cut
 *       both ways or it becomes a weapon against competitors. REJECTED does
 *       nothing to either.
 */
router.post(
  '/:id/review',
  requirePermission('reports'),
  validate({
    params: idParam,
    body: Joi.object({
      verdict: Joi.string()
        .valid(REPORT_STATUS.CONFIRMED, REPORT_STATUS.REJECTED, REPORT_STATUS.ABUSIVE)
        .required(),
      note,
    }),
  }),
  asyncHandler(async (req, res) => {
    const report = await reportService.review({
      actor: req.user,
      reportId: req.params.id,
      verdict: req.body.verdict,
      note: req.body.note,
    });
    return success(res, report, MESSAGES.REPORT.REVIEWED);
  })
);

/**
 * @openapi
 * /reports/{id}/hold:
 *   post:
 *     tags: [Report]
 *     summary: Hide the listing while the report is looked into
 *     description: >
 *       Not a verdict. The report stays pending and no strike is recorded, since
 *       nothing has been proven yet.
 */
router.post(
  '/:id/hold',
  requirePermission('reports'),
  validate({ params: idParam, body: Joi.object({ note }) }),
  asyncHandler(async (req, res) => {
    const report = await reportService.hold({
      actor: req.user,
      reportId: req.params.id,
      note: req.body.note,
    });
    return success(res, report, MESSAGES.REPORT.HELD);
  })
);

/**
 * @openapi
 * /reports/{id}/approve-suspension:
 *   post:
 *     tags: [Report]
 *     summary: Super admin signs off a suspension support could not carry out
 */
router.post(
  '/:id/approve-suspension',
  requirePermission('thirdStrike'),
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const report = await reportService.approveSuspension({
      actor: req.user,
      reportId: req.params.id,
    });
    return success(res, report, MESSAGES.REPORT.SUSPENSION_APPROVED);
  })
);

module.exports = router;
