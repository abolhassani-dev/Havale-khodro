const { Router } = require('express');
const Joi = require('joi');

const { staffService } = require('./staff.service');
const validate = require('../../middlewares/validate');
const asyncHandler = require('../../utils/asyncHandler');
const { success, created } = require('../../responses/apiResponse');
const { requirePermission } = require('../../middlewares/auth');
const { assignableRoles, ROLES, PERMISSION_KEYS } = require('../../constants/roles');

/**
 * Managing the accounts that run the system.
 *
 * Mounted under the admin router, so authentication and the admin check have
 * already run. Everything here additionally needs `staff`, which only the owner
 * has — and the service asserts it a second time from the acting user, because
 * a route is a statement about how a handler is *usually* reached, not a
 * guarantee.
 */
const router = Router();

router.use(requirePermission('staff'));

const idParam = Joi.object({ id: Joi.string().trim().max(40).required() });

// Only the roles that may actually be handed out. OWNER is absent from
// assignableRoles, so the schema itself refuses to accept it — the request is
// rejected before any handler has to remember to check.
const roleValues = assignableRoles(ROLES.OWNER);

// Keys are constrained to the ones that exist, so nothing arbitrary can be
// written into the JSON column.
const permissionsSchema = Joi.object(
  Object.fromEntries(PERMISSION_KEYS.map((key) => [key, Joi.boolean()]))
).unknown(false);

const createBody = Joi.object({
  username: Joi.string().trim().pattern(/^[a-zA-Z0-9._-]+$/).min(4).max(40).required()
    .messages({ 'string.pattern.base': 'نام کاربری فقط حروف انگلیسی، عدد، نقطه، خط تیره و زیرخط' }),
  password: Joi.string().min(10).max(128).required(),
  fullName: Joi.string().trim().min(2).max(80).required(),
  phone: Joi.string().trim().pattern(/^09\d{9}$/).required()
    .messages({ 'string.pattern.base': 'شماره باید با ۰۹ شروع شود و ۱۱ رقم باشد' }),
  role: Joi.string().valid(...roleValues).required(),
  permissions: permissionsSchema.optional(),
});

const updateBody = Joi.object({
  fullName: Joi.string().trim().min(2).max(80),
  phone: Joi.string().trim().pattern(/^09\d{9}$/),
  role: Joi.string().valid(...roleValues),
  status: Joi.string().valid('ACTIVE', 'SUSPENDED'),
  permissions: permissionsSchema,
}).min(1);

const passwordBody = Joi.object({ password: Joi.string().min(10).max(128).required() });

/** The checkbox layout and the assignable roles, so the screen is never stale. */
router.get(
  '/options',
  asyncHandler(async (req, res) => success(res, staffService.options(req.user)))
);

router.get(
  '/',
  asyncHandler(async (req, res) => success(res, await staffService.list(req.user)))
);

router.post(
  '/',
  validate({ body: createBody }),
  asyncHandler(async (req, res) =>
    created(res, await staffService.create({ actor: req.user, payload: req.body })))
);

router.patch(
  '/:id',
  validate({ params: idParam, body: updateBody }),
  asyncHandler(async (req, res) =>
    success(res, await staffService.update({ actor: req.user, id: req.params.id, payload: req.body })))
);

router.put(
  '/:id/password',
  validate({ params: idParam, body: passwordBody }),
  asyncHandler(async (req, res) =>
    success(res, await staffService.resetPassword({
      actor: req.user, id: req.params.id, password: req.body.password,
    })))
);

module.exports = router;
