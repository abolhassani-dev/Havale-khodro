const Joi = require('joi');

const iranMobile = Joi.string()
  .trim()
  .pattern(/^09\d{9}$/)
  .messages({ 'string.pattern.base': 'شماره موبایل باید با ۰۹ شروع شود و ۱۱ رقم باشد' });

/**
 * The sub-agent's profile is the same shape as any other agency's, minus the
 * agency code — that is derived from the parent's and is not the parent's to
 * choose (blueprint 2.3).
 */
const createBody = Joi.object({
  // Letters, digits and the separators people actually use. `alphanum()` would
  // have rejected `ali_reza`, which is an ordinary username and is accepted
  // everywhere else in the system — the two have to agree, or an account gets
  // created that cannot be created again.
  username: Joi.string()
    .trim()
    .lowercase()
    .pattern(/^[a-z0-9._-]+$/)
    .min(3)
    .max(60)
    .required()
    .messages({
      'string.pattern.base': 'نام کاربری فقط می‌تواند شامل حروف انگلیسی، عدد، نقطه، خط تیره و زیرخط باشد',
    }),
  password: Joi.string().min(8).max(128).required(),
  fullName: Joi.string().trim().min(3).max(120).required(),
  phone: iranMobile.required(),
  agencyName: Joi.string().trim().min(2).max(120).required(),
  city: Joi.string().trim().min(2).max(60).required(),
  coordinatorName: Joi.string().trim().min(3).max(120).required(),
  coordinatorPhone: iranMobile.required(),

  // Optional here, unlike on the admin's create form, and the difference is
  // deliberate. An admin creating an agency has no idea what it deals in, so
  // the question has to be asked. A parent creating a sub-agency already holds
  // a set of brands, and leaving this out means "the same as mine" — which is
  // the right answer for a sub-agency that is another desk rather than a
  // specialised one. Narrowing it is the interesting case, and that is what
  // sending the field does. The ceiling is the parent's own list either way.
  brandIds: Joi.array().items(Joi.string().trim().max(40)).min(1).messages({
    'array.min': 'اگر برند انتخاب می‌کنید، حداقل یکی لازم است',
  }),
});

const resetPasswordBody = Joi.object({
  password: Joi.string().min(8).max(128).required(),
});

const statusBody = Joi.object({
  status: Joi.string().valid('ACTIVE', 'SUSPENDED').required(),
});

const idParam = Joi.object({ id: Joi.string().trim().max(40).required() });

module.exports = {
  create: { body: createBody },
  resetPassword: { body: resetPasswordBody, params: idParam },
  setStatus: { body: statusBody, params: idParam },
  byId: { params: idParam },
};
