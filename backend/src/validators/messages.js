/**
 * Joi's messages, in Persian.
 *
 * Applied once in the validate middleware rather than schema by schema, so a
 * new schema is translated the day it is written and nobody has to remember.
 *
 * Why it matters: these strings are not diagnostics, they are what the person
 * filling in the form reads. Before this, a Persian panel answered a mistyped
 * field with «"username" length must be at least 3 characters long» — English,
 * in Latin script, right-aligned in a right-to-left page. The field name stays
 * as it is; the API's field keys are what the interface matches on to point at
 * the right input, and translating them would break that.
 */
module.exports = {
  'any.required': 'الزامی است',
  'any.only': 'مقدار انتخاب‌شده معتبر نیست',
  'any.unknown': 'این فیلد پذیرفته نمی‌شود',
  'any.invalid': 'مقدار وارد شده معتبر نیست',

  'string.base': 'باید متن باشد',
  'string.empty': 'نمی‌تواند خالی باشد',
  'string.min': 'حداقل {{#limit}} کاراکتر لازم است',
  'string.max': 'حداکثر {{#limit}} کاراکتر مجاز است',
  'string.length': 'باید دقیقاً {{#limit}} کاراکتر باشد',
  'string.pattern.base': 'قالب وارد شده درست نیست',
  'string.email': 'ایمیل معتبر نیست',
  'string.uri': 'نشانی معتبر نیست',

  'number.base': 'باید عدد باشد',
  'number.integer': 'باید عدد صحیح باشد',
  'number.min': 'نباید کمتر از {{#limit}} باشد',
  'number.max': 'نباید بیشتر از {{#limit}} باشد',
  'number.positive': 'باید بزرگ‌تر از صفر باشد',
  'number.unsafe': 'عدد وارد شده خارج از محدوده‌ی مجاز است',

  'boolean.base': 'باید بله یا خیر باشد',
  'date.base': 'تاریخ معتبر نیست',
  'date.greater': 'باید بعد از {{#limit}} باشد',
  'array.base': 'باید فهرست باشد',
  'array.min': 'حداقل {{#limit}} مورد لازم است',
  'array.max': 'حداکثر {{#limit}} مورد مجاز است',
  'object.base': 'ساختار ارسال‌شده درست نیست',
  'object.min': 'حداقل یک فیلد لازم است',
};
