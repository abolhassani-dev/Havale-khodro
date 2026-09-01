const Joi = require('joi');

const {
  CAR_KIND, CAR_SORT, PAINT_TOLERANCE, LIMITS, currentJalaliYear, BODY_PARTS, GRADE_FA,
} = require('./car.constants');
const { LIST_PAGE_SIZE, MAX_PAGE } = require('../../constants/havale');

/**
 * What may be posted in the خودرو market, and in what shape.
 *
 * The asymmetry is the product rule: somebody selling a car must say
 * everything a buyer decides by — year, mileage, colour, price, body — while
 * somebody looking for one may know only the model and a budget.
 *
 * The body table itself gets only a shallow check here; the deep one — which
 * parts exist, which condition each part may carry — lives in the service
 * next to the grade derivation, so the rules and their consequences cannot
 * drift apart. (Joi with stripUnknown would silently drop a mis-keyed part,
 * and silently losing a marked قطعه is worse than refusing it.)
 */

const toman = Joi.number().integer().min(0).max(LIMITS.TOMAN_MAX);

// Four Jalali digits, checked against the calendar at request time — a schema
// compiled before نوروز must not reject the new year for a whole process
// lifetime.
const year = Joi.number()
  .integer()
  .min(LIMITS.YEAR_MIN)
  .custom((value, helpers) => {
    if (value > currentJalaliYear() + 1) {
      return helpers.message('سال ساخت از سال آینده جلوتر است');
    }
    return value;
  });

const requiredForOffer = (schema) =>
  Joi.when('kind', {
    is: CAR_KIND.OFFER,
    then: schema.required(),
    otherwise: Joi.forbidden(),
  });

const requestOnly = (schema) =>
  Joi.when('kind', {
    is: CAR_KIND.REQUEST,
    then: schema,
    otherwise: Joi.forbidden(),
  });

const createBody = Joi.object({
  kind: Joi.string()
    .valid(...Object.values(CAR_KIND))
    .required(),

  // The car is the one field both sides must give. Body type is NOT here —
  // it comes off the catalogue model, never from the seller.
  carModelId: Joi.string().trim().max(40).required(),

  // ── the sale side ──
  year: requiredForOffer(year),
  mileageKm: requiredForOffer(Joi.number().integer().min(0).max(LIMITS.MILEAGE_MAX)),
  carColor: requiredForOffer(Joi.string().trim().max(40)),
  // A yes or no, and the seller has to say which: an advertisement that is
  // silent about the warranty reads as «no» to one buyer and «probably» to
  // the next.
  warranty: requiredForOffer(Joi.boolean()),
  carPriceToman: Joi.when('kind', {
    is: CAR_KIND.OFFER,
    then: toman.required(),
    // On a request this is the top of the budget — optional.
    otherwise: toman.allow(null).optional(),
  }),
  bodyStatus: Joi.when('kind', {
    is: CAR_KIND.OFFER,
    then: Joi.object().max(BODY_PARTS.length).optional(),
    otherwise: Joi.forbidden(),
  }),

  // ── the request side ──
  yearFrom: requestOnly(year.allow(null).optional()),
  yearTo: requestOnly(year.allow(null).optional()),
  maxMileageKm: requestOnly(
    Joi.number().integer().min(0).max(LIMITS.MILEAGE_MAX).allow(null).optional()
  ),
  priceFromToman: requestOnly(toman.allow(null).optional()),
  paintTolerance: requestOnly(
    Joi.string()
      .valid(...Object.values(PAINT_TOLERANCE))
      .default(PAINT_TOLERANCE.ANY)
  ),

  description: Joi.string().trim().max(LIMITS.DESCRIPTION_MAX).allow('', null),
})
  // A range given backwards is a typo worth catching before it hides listings.
  .custom((value, helpers) => {
    if (value.yearFrom && value.yearTo && value.yearFrom > value.yearTo) {
      return helpers.message('«سال از» نمی‌تواند بعد از «سال تا» باشد');
    }
    return value;
  });

// Editing cannot change what the advertisement fundamentally is: the model,
// the kind, and with them the body type stay put. The reveals already paid
// for on this advertisement must keep meaning what they meant.
const updateBody = Joi.object({
  year: year,
  mileageKm: Joi.number().integer().min(0).max(LIMITS.MILEAGE_MAX),
  carColor: Joi.string().trim().max(40),
  warranty: Joi.boolean(),
  carPriceToman: toman,
  bodyStatus: Joi.object().max(BODY_PARTS.length),
  yearFrom: year.allow(null),
  yearTo: year.allow(null),
  maxMileageKm: Joi.number().integer().min(0).max(LIMITS.MILEAGE_MAX).allow(null),
  priceFromToman: toman.allow(null),
  paintTolerance: Joi.string().valid(...Object.values(PAINT_TOLERANCE)),
  description: Joi.string().trim().max(LIMITS.DESCRIPTION_MAX).allow('', null),
}).min(1);

// A comma-separated pick from a fixed vocabulary — «سدان,هاچبک» in the
// address bar — validated word by word and handed on as an array.
const pickOf = (allowed) =>
  Joi.string()
    .trim()
    .max(120)
    .custom((value, helpers) => {
      const words = [...new Set(value.split(',').map((w) => w.trim()).filter(Boolean))];
      if (!words.length || words.some((w) => !allowed.includes(w))) {
        return helpers.error('any.invalid');
      }
      return words;
    });

const listQuery = Joi.object({
  kind: Joi.string().valid(...Object.values(CAR_KIND)),
  brandId: Joi.string().trim().max(40),
  carModelId: Joi.string().trim().max(40),
  // Several at once: a buyer who will take a sedan or a hatchback should not
  // have to search twice.
  bodyType: pickOf(['SEDAN', 'HATCHBACK', 'SUV', 'PICKUP']),
  yearFrom: year,
  yearTo: year,
  priceFrom: toman,
  priceTo: toman,
  maxMileage: Joi.number().integer().min(0).max(LIMITS.MILEAGE_MAX),
  // The five grades, any combination — «رنگ‌شده + تعویض‌دار» is one search.
  grades: pickOf(Object.keys(GRADE_FA)),
  // Only cars with a live warranty.
  warranty: Joi.boolean().truthy('1').falsy('0'),
  // How the results are ordered. The default — newest first — is the one
  // every market here uses; the other three are what a car is actually
  // shopped for.
  sort: Joi.string().valid(...Object.values(CAR_SORT)),
  limit: Joi.number().integer().min(1).max(LIST_PAGE_SIZE.MAX).default(LIST_PAGE_SIZE.DEFAULT),
  page: Joi.number().integer().min(1).max(MAX_PAGE),
});

const ownQuery = Joi.object({
  status: Joi.string().valid('ACTIVE', 'FULFILLED', 'EXPIRED', 'SUSPENDED', 'ARCHIVED'),
  scope: Joi.string().valid('own', 'children', 'all'),
  limit: Joi.number().integer().min(1).max(LIST_PAGE_SIZE.MAX).default(LIST_PAGE_SIZE.DEFAULT),
  page: Joi.number().integer().min(1).max(MAX_PAGE),
});

const byId = Joi.object({ id: Joi.string().trim().max(40).required() });

module.exports = {
  create: { body: createBody },
  update: { params: byId, body: updateBody },
  list: { query: listQuery },
  own: { query: ownQuery },
  byId: { params: byId },
};
