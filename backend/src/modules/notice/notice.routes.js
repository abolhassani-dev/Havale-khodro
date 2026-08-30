const { Router } = require('express');

const noticeService = require('./notice.service');
const asyncHandler = require('../../utils/asyncHandler');
const { success } = require('../../responses/apiResponse');
const { authenticate, requirePasswordChanged, requireRole } = require('../../middlewares/auth');
const { ROLES } = require('../../constants/roles');

const router = Router();

router.use(authenticate, requirePasswordChanged, requireRole(ROLES.AGENT));

// Deliberately no `requireActiveSubscription`: the box exists precisely for the
// agency whose access has just been taken away. Guarding it would mean the
// explanation for a suspension is behind the suspension.

/**
 * @openapi
 * /notices:
 *   get:
 *     tags: [Notice]
 *     summary: What the platform has decided about this agency
 *     description: >
 *       Built from the moderation record rather than stored — see the service
 *       for why. Includes `unread`, counted against the last time the box was
 *       marked read.
 */
router.get(
  '/',
  asyncHandler(async (req, res) => success(res, await noticeService.listFor(req.user)))
);

/**
 * @openapi
 * /notices/unread:
 *   get:
 *     tags: [Notice]
 *     summary: How many notices are new — the number the menu wears
 */
router.get(
  '/unread',
  asyncHandler(async (req, res) => success(res, { notices: await noticeService.unreadFor(req.user) }))
);

/**
 * @openapi
 * /notices/seen:
 *   post:
 *     tags: [Notice]
 *     summary: Mark the box read up to now
 */
router.post(
  '/seen',
  asyncHandler(async (req, res) => success(res, await noticeService.markSeen(req.user)))
);

module.exports = router;
