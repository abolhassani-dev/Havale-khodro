/**
 * Numbers that came out of the design decisions, in one place.
 *
 * They are here rather than inline so that changing a rule is a one-line edit
 * with the clause it came from written next to it — and so nobody has to guess
 * whether a `30` in a query means days or reveals.
 */

const HAVALE_KIND = {
  OFFER: 'OFFER', // حواله فروش
  REQUEST: 'REQUEST', // درخواست خرید
};

const HAVALE_STATUS = {
  ACTIVE: 'ACTIVE',
  FULFILLED: 'FULFILLED',
  EXPIRED: 'EXPIRED',
  SUSPENDED: 'SUSPENDED',
  ARCHIVED: 'ARCHIVED',
};

const SOLH_STATUS = {
  SOLH: 'SOLH',
  VEKALATI: 'VEKALATI',
};

/**
 * How the car itself is paid for — not how the transfer document is paid for.
 *
 * Required on a sale, optional on a purchase request: a seller knows the terms
 * of the car they hold, while a buyer looking for one may not care yet, and
 * forcing a choice would mean picking a term they do not actually require.
 */
const PAYMENT_TYPE = {
  CASH: 'CASH', // نقد
  STAGED: 'STAGED', // چند مرحله‌ای
  INSTALLMENT: 'INSTALLMENT', // اقساط
};

const PAYMENT_TYPE_LABELS = {
  CASH: 'نقد',
  STAGED: 'چند مرحله‌ای',
  INSTALLMENT: 'اقساط',
};

/** Blueprint 5.12: the deposit window is between one and thirty days. */
const DEPOSIT_DAYS = { MIN: 1, MAX: 30 };

/** Blueprint 13: a purchase request lives seven days. */
const REQUEST_LIFETIME_DAYS = 7;

/** Blueprint 16. Overridden per account by the fields on User when set. */
const DEFAULT_REVEAL_LIMITS = { DAILY: 30, MONTHLY: 300 };

/**
 * Review round 3, fix 2: the monthly cap runs on the subscription's own 30-day
 * period, not the Jalali month. Two parallel calendars meant an agent could
 * reset their monthly allowance by renewing a few days early.
 */
const REVEAL_PERIOD_DAYS = 30;

const LIST_PAGE_SIZE = { DEFAULT: 20, MAX: 50 };

module.exports = {
  HAVALE_KIND,
  HAVALE_STATUS,
  SOLH_STATUS,
  PAYMENT_TYPE,
  PAYMENT_TYPE_LABELS,
  DEPOSIT_DAYS,
  REQUEST_LIFETIME_DAYS,
  DEFAULT_REVEAL_LIMITS,
  REVEAL_PERIOD_DAYS,
  LIST_PAGE_SIZE,
};
