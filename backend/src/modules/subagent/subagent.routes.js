const { Router } = require('express');

const subagentService = require('./subagent.service');
const schema = require('./subagent.validator');
const validate = require('../../middlewares/validate');
const asyncHandler = require('../../utils/asyncHandler');
const { success, created } = require('../../responses/apiResponse');
const { authenticate, requirePasswordChanged, requireRole } = require('../../middlewares/auth');
const { ROLES } = require('../../constants/roles');
const { MESSAGES } = require('../../constants/messages');

const router = Router();

router.use(authenticate, requirePasswordChanged, requireRole(ROLES.AGENT));

/**
 * @openapi
 * /sub-agents:
 *   get:
 *     tags: [SubAgent]
 *     summary: The reseller's sub-agencies and remaining capacity
 *     description: >
 *       Counts and last sign-in only. A sub-agent's own listings and the contacts
 *       they have opened are not visible to the parent.
 */
router.get(
  '/',
  asyncHandler(async (req, res) => success(res, await subagentService.list(req.user)))
);

/**
 * @openapi
 * /sub-agents:
 *   post:
 *     tags: [SubAgent]
 *     summary: Create a sub-agency, consuming one seat
 *     description: >
 *       Needs module mode switched on by an admin, a live subscription, and
 *       spare capacity. The agency code is derived from the parent's.
 *     responses:
 *       201: { description: Created }
 *       403: { description: Not a reseller, no capacity, or subscription expired }
 *       409: { description: Username taken }
 */
router.post(
  '/',
  validate(schema.create),
  asyncHandler(async (req, res) => {
    const child = await subagentService.create({ user: req.user, payload: req.body });
    return created(res, child, MESSAGES.SEAT.SUBAGENT_CREATED);
  })
);

/**
 * @openapi
 * /sub-agents/{id}/status:
 *   put:
 *     tags: [SubAgent]
 *     summary: Suspend or reactivate a sub-agency
 *     description: >
 *       Suspending does not release the seat until the period ends, and does not
 *       refund it — capacity is paid for up front.
 */
router.put(
  '/:id/status',
  validate(schema.setStatus),
  asyncHandler(async (req, res) => {
    const child = await subagentService.setStatus({
      user: req.user,
      id: req.params.id,
      status: req.body.status,
    });
    return success(res, child);
  })
);

/**
 * @openapi
 * /sub-agents/{id}/password:
 *   put:
 *     tags: [SubAgent]
 *     summary: Set a sub-agency's password
 *     description: >
 *       Ends every live session for that account and forces a change on the next
 *       sign-in, since the parent now knows the password.
 */
router.put(
  '/:id/password',
  validate(schema.resetPassword),
  asyncHandler(async (req, res) => {
    const result = await subagentService.resetPassword({
      user: req.user,
      id: req.params.id,
      password: req.body.password,
    });
    return success(res, result, MESSAGES.AUTH.PASSWORD_CHANGED);
  })
);

module.exports = router;
