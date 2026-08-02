/**
 * The starting catalogue.
 *
 * Compiled from Iranian market reporting in mid-1405 (mid-2026). Treat it as a
 * starting point rather than a source of truth: the lineup changes every few
 * months, and the admin panel is where it gets corrected. Nothing in the code
 * depends on these particular names — a listing snapshots the model name it was
 * created with, so renaming or removing a model here never rewrites or breaks an
 * existing listing.
 *
 * Structure is company → brand → model. Modiran Khodro assembles Chery vehicles
 * under three brands, which is why there is a company level at all: phase two
 * adds other importers beside it without any of this having to move.
 */

const COMPANIES = [
  {
    name: 'مدیران خودرو',
    slug: 'modiran-khodro',
    sortOrder: 1,
    brands: [
      {
        // The volume brand — Chery's mainstream Tiggo and Arrizo range.
        name: 'ام‌وی‌ام',
        slug: 'mvm',
        sortOrder: 1,
        models: [
          'ام‌وی‌ام X22 پرو دنده‌ای',
          'ام‌وی‌ام X22 پرو اتوماتیک',
          'ام‌وی‌ام X33 کراس دنده‌ای',
          'ام‌وی‌ام X33 کراس اتوماتیک',
          'ام‌وی‌ام X55 پرو',
          'ام‌وی‌ام X55 پرو IE',
          'ام‌وی‌ام X77',
        ],
      },
      {
        // Launched 1401/2022 as the upper range; most of the current sales
        // announcements are Fownix models.
        name: 'فونیکس',
        slug: 'fownix',
        sortOrder: 2,
        models: [
          'فونیکس FX',
          'فونیکس FX پریمیوم',
          'فونیکس FX EV',
          'فونیکس Z6 GT',
          'فونیکس Z8',
          'فونیکس Z8 GI',
          'فونیکس F7',
          'فونیکس F7 پرو پریمیوم',
          'فونیکس F7 پرو مکس',
          'فونیکس F7 پرو e هیبرید',
          'فونیکس F8',
          'فونیکس F8 پرو مکس',
          'فونیکس F8 پرو مکس AWD',
          'فونیکس F8 پرو مکس IE',
          'فونیکس F8 پرو e هیبرید',
          'فونیکس F9',
        ],
      },
      {
        // The luxury sub-brand, introduced late 1402/2023, based on Chery's
        // Exeed range. Three models are confirmed on sale; more are announced.
        name: 'اکستریم',
        slug: 'xtrim',
        sortOrder: 3,
        models: ['اکستریم LX', 'اکستریم TXL', 'اکستریم VX'],
      },
    ],
  },
];

/**
 * Standard colours.
 *
 * A closed list is what makes the colour filter work at all: as free text,
 * «سفید» and «سفيد» — the same word with an Arabic yeh — are two different
 * colours that never find each other.
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

module.exports = { COMPANIES, COLORS };
