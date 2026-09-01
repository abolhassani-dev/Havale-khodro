const Joi = require('joi');

const {
  REGISTRATION_KIND,
  REGISTRATION_METHOD,
  REGISTRATION_SALE_TYPE,
  LIMITS,
} = require('./registration.constants');
const { idList } = require('../../utils/queryList');
const { LIST_PAGE_SIZE, MAX_PAGE } = require('../../constants/havale');

/**
 * What may be posted in this market, and in what shape.
 *
 * The asymmetry between the two sides is the product rule, not an oversight: an
 * agency announcing capacity has to say everything a buyer needs to decide —
 * which scheme, how it is allocated, what it costs, and until when — while an
 * agency looking for capacity may know only which car it wants. Forcing a buyer
 * to invent a scheme name would stop deals rather than describe them.
 */

const toman = Joi.number().integer().min(0).max(LIMITS.TOMAN_MAX);

const requiredForOffer = (schema) =>
  Joi.when('kind', {
    is: REGISTRATION_KIND.OFFER,
    then: schema.required(),
    otherwise: schema.allow(null).optional(),
  });

const createBody = Joi.object({
  kind: Joi.string()
    .valid(...Object.values(REGISTRATION_KIND))
    .required(),

  // The car is the one field both sides must give: it is what the brand rules
  // are enforced on, and what anybody searches by.
  carModelId: Joi.string().trim().max(40).required(),

  planName: requiredForOffer(Joi.string().trim().max(LIMITS.PLAN_NAME_MAX)),
  method: requiredForOffer(Joi.string().valid(...Object.values(REGISTRATION_METHOD))),
  saleType: requiredForOffer(Joi.string().valid(...Object.values(REGISTRATION_SALE_TYPE))),
  capacity: requiredForOffer(Joi.number().integer().min(1).max(LIMITS.CAPACITY_MAX)),

  // The money the factory asks for, and the money this agency asks for. Two
  // different numbers that people confuse constantly, which is why the form
  // labels them apart and the API keeps them apart.
  depositToman: requiredForOffer(toman),
  premiumToman: requiredForOffer(toman),

  // The scheme's own deadline. Optional even for an offer: some schemes have
  // none, and the advertisement then simply gets the default lifetime.
  registerDeadline: Joi.date().iso().greater('now').allow(null).optional(),

  deliveryEstimate: Joi.string().trim().max(LIMITS.DELIVERY_MAX).allow('', null),
  conditions: Joi.string().trim().max(LIMITS.CONDITIONS_MAX).allow('', null),
  description: Joi.string().trim().max(LIMITS.DESCRIPTION_MAX).allow('', null),
});

// Editing cannot change what the advertisement fundamentally is: its market
// side and its car stay put. Somebody who wants to advertise a different car is
// posting a different advertisement, and the reveals already paid for on this
// one must keep meaning what they meant.
const updateBody = Joi.object({
  planName: Joi.string().trim().max(LIMITS.PLAN_NAME_MAX),
  method: Joi.string().valid(...Object.values(REGISTRATION_METHOD)),
  saleType: Joi.string().valid(...Object.values(REGISTRATION_SALE_TYPE)),
  capacity: Joi.number().integer().min(1).max(LIMITS.CAPACITY_MAX),
  depositToman: toman,
  premiumToman: toman,
  registerDeadline: Joi.date().iso().greater('now').allow(null),
  deliveryEstimate: Joi.string().trim().max(LIMITS.DELIVERY_MAX).allow('', null),
  conditions: Joi.string().trim().max(LIMITS.CONDITIONS_MAX).allow('', null),
  description: Joi.string().trim().max(LIMITS.DESCRIPTION_MAX).allow('', null),
}).min(1);

const listQuery = Joi.object({
  kind: Joi.string().valid(...Object.values(REGISTRATION_KIND)),
  // Several brands or models in one search — see utils/queryList.
  brandIds: idList(),
  carModelIds: idList(),
  method: Joi.string().valid(...Object.values(REGISTRATION_METHOD)),
  saleType: Joi.string().valid(...Object.values(REGISTRATION_SALE_TYPE)),
  maxPremium: toman,
  city: Joi.string().trim().max(60),
  limit: Joi.number().integer().min(1).max(LIST_PAGE_SIZE.MAX).default(LIST_PAGE_SIZE.DEFAULT),
  cursor: Joi.string().trim().max(120),
  page: Joi.number().integer().min(1).max(MAX_PAGE),
});

const ownQuery = Joi.object({
  status: Joi.string().valid('ACTIVE', 'FULFILLED', 'EXPIRED', 'SUSPENDED', 'ARCHIVED'),
  // «آگهی‌های خودم» / «زیرشاخه‌ها» / both — the same three the حواله market has,
  // because a parent agency thinks about its family the same way in either.
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
