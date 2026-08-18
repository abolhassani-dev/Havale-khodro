/**
 * The colour list.
 *
 * Brands and models used to live here too. They now come from
 * `carCatalog.data.json`, built by `scripts/build-catalog.js` from the Iranian
 * market list — 186 brands and 2044 models, which is not something to maintain
 * by hand in a source file.
 *
 * Colours stayed: there are twelve, they change never, and they are a product
 * decision rather than market data.
 */

const COLORS = [
  'سفید',
  'مشکی',
  'خاکستری',
  'نوک‌مدادی',
  'نقره‌ای',
  'تیتانیوم',
  'آبی',
  'قرمز',
  'سبز',
  'قهوه‌ای',
  'بژ',
  'طوسی',
];

module.exports = { COLORS };
