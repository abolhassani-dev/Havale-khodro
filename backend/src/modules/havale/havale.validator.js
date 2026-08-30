const Joi = require('joi');

const {
  HAVALE_KIND,
  HAVALE_STATUS,
  SOLH_STATUS,
  PAYMENT_TYPE,
  DEPOSIT_DAYS,
  LIST_PAGE_SIZE,
} = require('../../constants/havale');

/**
 * Input rules.
 *
 * Two jobs, and they are not the same one. The first is the product rule that a
 * sale listing is fully specified while a purchase request needs only a car type
 * and a transfer form (blueprint 5.2) — a buyer who is flexible should not be
 * forced to invent a colour. The second is refusing anything malformed at the
 * edge, so no layer below has to wonder whether `amountToman` might be a string.
 */

const toman = Joi.number().integer().min(0).max(100_000_000_000);
const days = Joi.number().integer().min(1).max(3650);

const requiredForOffer = (schema) =>
  Joi.when('kind', {
    is: HAVALE_KIND.OFFER,
    then: schema.required(),
    otherwise: schema.allow(null).optional(),
  });

const createBody = Joi.object({
  kind: Joi.string()
    .valid(...Object.values(HAVALE_KIND))
    .required(),

  // Required in both: without these two a listing says nothing at all.
  // The model is chosen from the catalogue rather than typed, so that filtering
  // works — as free text «فونیکس FX» and «فونیکس اف ایکس» are two different cars
  // and neither ever finds the other.
  carModelId: Joi.string().trim().max(40).required(),
  solh: Joi.string()
    .valid(...Object.values(SOLH_STATUS))
    .required(),

  carColor: requiredForOffer(Joi.string().trim().max(60)),
  model: requiredForOffer(Joi.string().trim().max(20)),
  amountToman: requiredForOffer(toman),
  paidAmountToman: requiredForOffer(toman),
  carPriceToman: requiredForOffer(toman),
  paymentType: requiredForOffer(Joi.string().valid(...Object.values(PAYMENT_TYPE))),
  deliveryDays: requiredForOffer(days),

  // The deposit window is also the listing's lifetime, which is why zero is not
  // allowed: it would create a listing that was already dead (review round 1,
  // fix 5).
  depositDays: requiredForOffer(
    Joi.number().integer().min(DEPOSIT_DAYS.MIN).max(DEPOSIT_DAYS.MAX)
  ),

  // The supplying company is not an input: it is read from the chosen model, so
  // a listing cannot claim a Fownix is built by someone else.

  description: Joi.string().trim().max(1000).allow('', null).optional(),
})
  // Contact details are deliberately not accepted here. They are read from the
  // owner's profile every time, so that a corrected phone number fixes every
  // listing at once instead of none of them (blueprint 27).
  .custom((value, helpers) => {
    const hasBoth =
      value.paidAmountToman !== null &&
      value.paidAmountToman !== undefined &&
      value.amountToman !== null &&
      value.amountToman !== undefined;

    if (hasBoth) {
      if (BigInt(value.paidAmountToman) > BigInt(value.amountToman)) {
        // `helpers.message`, not `helpers.error('any.custom', { message })`.
        // The latter fills Joi's own template — «"value" failed custom
        // validation because {{#error.message}}» — from an `error` key that is
        // not being passed, so the Persian sentence written here was dropped
        // and the user was shown that fragment with an empty ending.
        return helpers.message('مبلغ واریز شده نمی‌تواند از مبلغ حواله بیشتر باشد');
      }
    }
    return value;
  }, 'paid amount within total');

// Two fields are not editable. The kind, because the required-field rules
// differ between the two and flipping it would leave a half-filled row behind.
// The car, because it is what the advertisement *is*: everything else on the
// card is a detail of the deal, but changing «پژو ۲۰۷» into «پراید» on a row
// that already carries three days of age and a view count is not an edit, it
// is a different advertisement wearing the first one's history.
const updateBody = Joi.object({
  solh: Joi.string().valid(...Object.values(SOLH_STATUS)),
  carColor: Joi.string().trim().max(60).allow(null),
  model: Joi.string().trim().max(20).allow(null),
  amountToman: toman.allow(null),
  paidAmountToman: toman.allow(null),
  carPriceToman: toman.allow(null),
  paymentType: Joi.string().valid(...Object.values(PAYMENT_TYPE)).allow(null),
  deliveryDays: days.allow(null),
  description: Joi.string().trim().max(1000).allow('', null),
})
  .min(1)
  .messages({ 'object.min': 'حداقل یک فیلد برای ویرایش لازم است' });

const renewBody = Joi.object({
  deliveryDays: days.required(),
  depositDays: Joi.number()
    .integer()
    .min(DEPOSIT_DAYS.MIN)
    .max(DEPOSIT_DAYS.MAX)
    .required(),
});

const listQuery = Joi.object({
  kind: Joi.string().valid(...Object.values(HAVALE_KIND)),
  // Exact when the agent picks from the list, free text when they type in the
  // search box — both are useful and they are not the same query.
  carModelId: Joi.string().trim().max(40),
  brandId: Joi.string().trim().max(40),
  carType: Joi.string().trim().max(120),
  carColor: Joi.string().trim().max(60),
  model: Joi.string().trim().max(20),
  solh: Joi.string().valid(...Object.values(SOLH_STATUS)),
  supplierCompany: Joi.string().trim().max(120),
  minAmount: toman,
  maxAmount: toman,
  maxDeliveryDays: days,
  cursor: Joi.string().max(200),
  page: Joi.number().integer().min(1).max(10000),
  network: Joi.string().valid('mine'),
  limit: Joi.number().integer().min(1).max(LIST_PAGE_SIZE.MAX).default(LIST_PAGE_SIZE.DEFAULT),
});

const ownQuery = Joi.object({
  status: Joi.string().valid(...Object.values(HAVALE_STATUS)),
  // A reseller may widen the view to its sub-agencies' listings. Anyone else
  // sends it in vain — the service pins them to their own.
  scope: Joi.string().valid('own', 'children', 'all').default('own'),
  cursor: Joi.string().max(200),
  limit: Joi.number().integer().min(1).max(LIST_PAGE_SIZE.MAX).default(LIST_PAGE_SIZE.DEFAULT),
});

const idParam = Joi.object({ id: Joi.string().trim().max(40).required() });

module.exports = {
  create: { body: createBody },
  update: { body: updateBody, params: idParam },
  renew: { body: renewBody, params: idParam },
  list: { query: listQuery },
  own: { query: ownQuery },
  byId: { params: idParam },
};
