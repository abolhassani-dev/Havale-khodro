/**
 * The vocabulary of the خودرو market.
 *
 * The heart of it is the body table: twenty-two parts, each allowed a small
 * set of conditions, summarised into one grade. The list and the per-part
 * options mirror the کارشناسی بدنه every dealer already knows (the خودرو۴۵
 * pattern), so nobody has to learn a new language to read an advertisement.
 *
 * Kept in the market's own folder: nothing outside this market has any
 * business knowing what a «سرشاسی» is.
 */

const CAR_KIND = {
  OFFER: 'OFFER', // آگهی فروش خودرو
  REQUEST: 'REQUEST', // درخواست خرید خودرو
};

/** What can be wrong with one part. */
const PART_STATUS = {
  PARTIAL: 'PARTIAL', // رنگ جزئی
  PAINT: 'PAINT', // رنگ
  SPRAY: 'SPRAY', // پاشش رنگ
  DAMAGE: 'DAMAGE', // آسیب جزئی — فقط قطعات شاسی
  REPLACE: 'REPLACE', // تعویض
};

// Which statuses each class of part accepts. «رنگ جزئی» on a chassis rail
// means nothing — a rail is not painted panel-deep — which is why the classes
// exist instead of one shared list.
const PANEL = ['PARTIAL', 'PAINT', 'REPLACE', 'SPRAY'];
const CHASSIS = ['DAMAGE', 'PAINT', 'REPLACE', 'SPRAY'];
const RAIL = ['DAMAGE', 'PAINT', 'REPLACE'];
const SILL = ['PARTIAL', 'PAINT', 'REPLACE'];
const TRAY = ['PARTIAL', 'PAINT', 'REPLACE', 'SPRAY'];

/**
 * The twenty-two parts, in the order the form shows them.
 * `chassis: true` marks the parts whose damage makes a car «شاسی‌خورده».
 */
const BODY_PARTS = [
  { key: 'fnd-f-d', fa: 'گلگیر جلو راننده', allowed: PANEL },
  { key: 'fnd-f-p', fa: 'گلگیر جلو شاگرد', allowed: PANEL },
  { key: 'fnd-r-d', fa: 'گلگیر عقب راننده', allowed: PANEL },
  { key: 'fnd-r-p', fa: 'گلگیر عقب شاگرد', allowed: PANEL },
  { key: 'dr-f-d', fa: 'درب جلو راننده', allowed: PANEL },
  { key: 'dr-f-p', fa: 'درب جلو شاگرد', allowed: PANEL },
  { key: 'dr-r-d', fa: 'درب عقب راننده', allowed: PANEL },
  { key: 'dr-r-p', fa: 'درب عقب شاگرد', allowed: PANEL },
  { key: 'hood', fa: 'کاپوت', allowed: PANEL },
  { key: 'trunk', fa: 'صندوق', allowed: PANEL },
  { key: 'roof', fa: 'سقف', allowed: PANEL },
  { key: 'chs-f-d', fa: 'شاسی جلو راننده', allowed: CHASSIS, chassis: true },
  { key: 'chs-f-p', fa: 'شاسی جلو شاگرد', allowed: CHASSIS, chassis: true },
  { key: 'chs-r-d', fa: 'شاسی عقب راننده', allowed: CHASSIS, chassis: true },
  { key: 'chs-r-p', fa: 'شاسی عقب شاگرد', allowed: CHASSIS, chassis: true },
  { key: 'rl-f-d', fa: 'سرشاسی جلو راننده', allowed: RAIL, chassis: true },
  { key: 'rl-f-p', fa: 'سرشاسی جلو شاگرد', allowed: RAIL, chassis: true },
  { key: 'rl-r-d', fa: 'سرشاسی عقب راننده', allowed: RAIL, chassis: true },
  { key: 'rl-r-p', fa: 'سرشاسی عقب شاگرد', allowed: RAIL, chassis: true },
  { key: 'sill-f', fa: 'پالونی جلو', allowed: SILL },
  { key: 'sill-r', fa: 'پالونی عقب', allowed: SILL },
  { key: 'tray', fa: 'سینی و پالونی', allowed: TRAY },
];

const PART_BY_KEY = Object.fromEntries(BODY_PARTS.map((p) => [p.key, p]));

/**
 * The one-word summary a buyer filters by, derived from the table and never
 * asked separately — a summary that is computed cannot contradict its table.
 *
 * Severity is a ladder, worst wins: chassis damage outranks a replaced panel,
 * a replaced panel outranks paint, full paint outranks a touch-up. پاشش رنگ
 * on a chassis part does not make a car «شاسی‌خورده» — overspray reaches the
 * rails from painting the panel above them.
 */
function deriveGrade(bodyStatus) {
  const entries = Object.entries(bodyStatus || {});
  if (!entries.length) return 'NO_PAINT';

  const chassisHit = entries.some(([key, st]) => PART_BY_KEY[key]?.chassis && st !== 'SPRAY');
  if (chassisHit) return 'CHASSIS_DAMAGED';
  const statuses = entries.map(([, st]) => st);
  if (statuses.includes('REPLACE')) return 'REPLACED';
  if (statuses.includes('PAINT')) return 'PAINTED';
  return 'MINOR_PAINT';
}

/**
 * The deep check of a body table: every key a real part, every condition one
 * that part accepts. Returns the Persian sentence to refuse with, or null.
 * Lives here beside the vocabulary so the rules and the derivation that
 * consumes them cannot drift apart.
 */
function bodyStatusError(bodyStatus) {
  if (bodyStatus === null || bodyStatus === undefined) return null;
  if (typeof bodyStatus !== 'object' || Array.isArray(bodyStatus)) {
    return 'قالب وضعیت بدنه معتبر نیست';
  }
  for (const [key, status] of Object.entries(bodyStatus)) {
    const part = PART_BY_KEY[key];
    if (!part) return 'قطعه‌ای ناشناخته در وضعیت بدنه علامت خورده است';
    if (!part.allowed.includes(status)) {
      return `وضعیت انتخاب‌شده برای «${part.fa}» مجاز نیست`;
    }
  }
  return null;
}

const GRADE_FA = {
  NO_PAINT: 'بدون رنگ',
  MINOR_PAINT: 'رنگ جزئی',
  PAINTED: 'رنگ‌شده',
  REPLACED: 'تعویض‌دار',
  CHASSIS_DAMAGED: 'شاسی‌خورده',
};

const PART_STATUS_FA = {
  PARTIAL: 'رنگ جزئی',
  PAINT: 'رنگ',
  SPRAY: 'پاشش رنگ',
  DAMAGE: 'آسیب جزئی',
  REPLACE: 'تعویض',
};

const BODY_TYPE_FA = {
  SEDAN: 'سدان',
  HATCHBACK: 'هاچبک',
  SUV: 'شاسی‌بلند',
  PICKUP: 'وانت / دوکابین',
};

const PAINT_TOLERANCE = {
  NO_PAINT_ONLY: 'NO_PAINT_ONLY', // فقط بدون رنگ
  MINOR_OK: 'MINOR_OK', // تا رنگ جزئی اوکی است
  ANY: 'ANY', // فرقی نمی‌کند
};

const PAINT_TOLERANCE_FA = {
  NO_PAINT_ONLY: 'فقط بدون رنگ',
  MINOR_OK: 'تا رنگ جزئی',
  ANY: 'فرقی نمی‌کند',
};

/**
 * How a list of cars may be ordered.
 *
 * Newest first is the default and the other markets' only order. A car is
 * shopped for differently: the same model at four agencies is one decision
 * about price, and «کم‌کارکردترین» is the question a used-car buyer asks
 * second. The vocabulary lives here so the query, the validator and the
 * screen cannot each invent their own spelling of it.
 */
const CAR_SORT = {
  NEW: 'new',
  CHEAP: 'cheap',
  EXPENSIVE: 'expensive',
  LOW_MILEAGE: 'km',
};

/** The current Jalali year, from Intl itself — no hand-rolled leap table. */
function currentJalaliYear() {
  return Number(
    new Intl.DateTimeFormat('en-US-u-ca-persian', { year: 'numeric' })
      .format(new Date())
      .replace(/\D/g, '')
  );
}

/**
 * How long an advertisement lives: seven days either way, like a حواله —
 * a car for sale is either sold that week or worth re-posting at a new price.
 */
const LIFETIME_DAYS = { OFFER: 7, REQUEST: 7 };

const LIMITS = {
  YEAR_MIN: 1350,
  TOMAN_MAX: 100_000_000_000,
  MILEAGE_MAX: 2_000_000,
  DESCRIPTION_MAX: 1000,
  PHOTO_MAX: 6,
  PHOTO_BYTES_MAX: 5 * 1024 * 1024,
};

module.exports = {
  CAR_KIND,
  CAR_SORT,
  PART_STATUS,
  BODY_PARTS,
  PART_BY_KEY,
  deriveGrade,
  bodyStatusError,
  GRADE_FA,
  PART_STATUS_FA,
  BODY_TYPE_FA,
  PAINT_TOLERANCE,
  PAINT_TOLERANCE_FA,
  currentJalaliYear,
  LIFETIME_DAYS,
  LIMITS,
};
