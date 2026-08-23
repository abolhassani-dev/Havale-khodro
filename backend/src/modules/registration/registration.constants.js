/**
 * The vocabulary of the ثبت‌نامی market.
 *
 * Kept in the market's own folder rather than in the shared constants: nothing
 * outside this market has any business knowing what a «طرح» is, and a shared
 * file that every market edits is the thing this architecture exists to avoid.
 */

/** Two sides of the market, named as the panel names them. */
const REGISTRATION_KIND = {
  OFFER: 'OFFER', // اعلام ظرفیت ثبت‌نام
  REQUEST: 'REQUEST', // ثبت درخواست ثبت‌نام
};

/** How the factory decides who gets a slot. */
const REGISTRATION_METHOD = {
  LOTTERY: 'LOTTERY', // قرعه‌کشی — اسامی قرعه‌کشی می‌شود
  TIME_PRIORITY: 'TIME_PRIORITY', // اولویت زمانی — هر کس زودتر ثبت کند
};

/** How the car itself is paid for in the scheme. */
const REGISTRATION_SALE_TYPE = {
  PRESALE: 'PRESALE', // پیش‌فروش
  CASH_SINGLE: 'CASH_SINGLE', // نقدی تک‌مرحله‌ای
  CASH_STAGED: 'CASH_STAGED', // نقدی چند مرحله‌ای
  INSTALLMENT: 'INSTALLMENT', // اقساط
  PRODUCTION_PARTNERSHIP: 'PRODUCTION_PARTNERSHIP', // مشارکت در تولید
};

/**
 * How long an advertisement lives.
 *
 * A capacity offer lives until the scheme's own deadline, because that is the
 * day it stops being true — but never longer than a month, so a scheme with a
 * distant deadline cannot leave a stale advertisement standing all season. A
 * request is seven days, exactly like the حواله market: somebody looking to buy
 * either finds it that week or their situation has changed.
 */
const LIFETIME_DAYS = { MAX_OFFER: 30, DEFAULT_OFFER: 30, REQUEST: 7 };

/** Ceilings that keep a typo from becoming a headline. */
const LIMITS = {
  CAPACITY_MAX: 500,
  TOMAN_MAX: 100_000_000_000,
  PLAN_NAME_MAX: 120,
  CONDITIONS_MAX: 300,
  DELIVERY_MAX: 60,
  DESCRIPTION_MAX: 1000,
};

module.exports = {
  REGISTRATION_KIND,
  REGISTRATION_METHOD,
  REGISTRATION_SALE_TYPE,
  LIFETIME_DAYS,
  LIMITS,
};
