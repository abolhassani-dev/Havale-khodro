/**
 * Numbers and dates, as an Iranian user reads them.
 *
 * Persian digits everywhere, Jalali dates, thousands separators. Latin numerals
 * in a Persian sentence read as a bug to the person looking at them, and a
 * Gregorian date is a number an agency has to convert in their head before it
 * means anything.
 */

const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

export function faDigits(value) {
  return String(value).replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)]);
}

/** Back to Latin digits, for anything that goes to the server or into a URL. */
export function enDigits(value) {
  return String(value)
    .replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}

export function num(value) {
  if (value === null || value === undefined || value === '') return '—';
  return faDigits(Number(value).toLocaleString('en-US'));
}

/** Toman, with the unit. */
export function money(value) {
  if (value === null || value === undefined) return '—';
  return `${num(value)} تومان`;
}

/** Human file size, e.g. «۳۲۰ کیلوبایت» / «۱٫۴ مگابایت». */
export function fileSize(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024 * 1024) return `${faDigits(Math.max(1, Math.round(bytes / 1024)))} کیلوبایت`;
  return `${faDigits((bytes / (1024 * 1024)).toFixed(1))} مگابایت`;
}

const JALALI = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const JALALI_TIME = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function date(value) {
  if (!value) return '—';
  return JALALI.format(new Date(value));
}

export function dateTime(value) {
  if (!value) return '—';
  return JALALI_TIME.format(new Date(value));
}

const TIME_ONLY = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** Just the clock — for feeds where a day heading already carries the date. */
export function timeOnly(value) {
  if (!value) return '—';
  return TIME_ONLY.format(new Date(value));
}

/**
 * "۳ روز دیگر" / "۲ ساعت دیگر".
 *
 * A closing date on its own makes an agency do arithmetic to find out whether
 * their listing dies tonight or next week.
 */
export function until(value) {
  if (!value) return '—';
  const ms = new Date(value) - Date.now();
  if (ms <= 0) return 'تمام شده';

  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours < 24) return `${faDigits(Math.max(1, hours))} ساعت دیگر`;
  return `${faDigits(Math.floor(hours / 24))} روز دیگر`;
}

export function relative(value) {
  if (!value) return '—';
  const ms = Date.now() - new Date(value);
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'همین حالا';
  if (minutes < 60) return `${faDigits(minutes)} دقیقه پیش`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${faDigits(hours)} ساعت پیش`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${faDigits(days)} روز پیش`;
  return date(value);
}

export const SOLH_LABEL = { SOLH: 'صلح', VEKALATI: 'وکالتی' };

export const KIND_LABEL = { OFFER: 'حواله فروش', REQUEST: 'درخواست خرید' };

/**
 * How the car itself is paid for.
 *
 * An array rather than an object so the dropdown keeps this order — نقد first,
 * because it is both the simplest and the most common. Object key order happens
 * to be stable for string keys, but relying on that to lay out an interface is
 * relying on something nobody wrote down.
 */
export const PAYMENT_TYPES = [
  ['CASH', 'نقد'],
  ['STAGED', 'چند مرحله‌ای'],
  ['INSTALLMENT', 'اقساط'],
];

export const PAYMENT_TYPE_LABEL = Object.fromEntries(PAYMENT_TYPES);

export const HAVALE_STATUS_LABEL = {
  ACTIVE: 'فعال',
  FULFILLED: 'فروخته شد',
  EXPIRED: 'منقضی',
  SUSPENDED: 'تعلیق‌شده',
  ARCHIVED: 'بایگانی',
};

export const REPORT_REASON_LABEL = {
  FAKE_LISTING: 'آگهی جعلی',
  WRONG_PRICE: 'مبلغ نادرست',
  UNREACHABLE: 'عدم پاسخگویی',
  ALREADY_SOLD: 'قبلاً فروخته شده',
  FRAUD: 'کلاهبرداری',
  CONTACT_IN_TEXT: 'درج اطلاعات تماس در متن آگهی',
  OTHER: 'سایر',
};

export const REPORT_STATUS_LABEL = {
  PENDING: 'در انتظار بررسی',
  CONFIRMED: 'تخلف تأیید شد',
  REJECTED: 'رد شد',
  ABUSIVE: 'گزارش بی‌مورد',
};

export const TICKET_STATUS_LABEL = { OPEN: 'باز', ANSWERED: 'پاسخ داده شد', CLOSED: 'بسته' };

export const TICKET_PRIORITY_LABEL = { LOW: 'کم', NORMAL: 'عادی', HIGH: 'فوری' };

/**
 * What a conversation is about.
 *
 * The order is the order they are offered in, and it is deliberate: the two
 * things agencies write about most — paying us and buying capacity — come
 * first. `icon` and `hint` are here rather than in the page so the tiles, the
 * row badges and the admin's filter chips can never disagree about what a
 * category is called.
 */
export const TICKET_CATEGORIES = [
  { value: 'SUBSCRIPTION', label: 'اشتراک و تمدید', icon: 'clock',
    hint: 'تمدید، فاکتور، یا سؤال درباره‌ی مبلغ' },
  { value: 'SEATS', label: 'ظرفیت زیرنمایندگی', icon: 'layers',
    hint: 'خرید ظرفیت و حالت ماژول' },
  { value: 'LISTING', label: 'آگهی و کاتالوگ', icon: 'car',
    hint: 'مشکل در ثبت آگهی، یا نبودن یک برند و مدل' },
  { value: 'APPEAL', label: 'اعتراض به اخطار', icon: 'flag',
    hint: 'اگر گزارشی علیه شما تأیید شده و اعتراض دارید' },
  { value: 'TECHNICAL', label: 'مشکل فنی', icon: 'wrench',
    hint: 'خطای سامانه، ورود، یا چیزی که کار نمی‌کند' },
  { value: 'OTHER', label: 'موضوع دیگر', icon: 'mail',
    hint: 'هر چیزی که در دسته‌های بالا نمی‌گنجد' },
];

export const TICKET_CATEGORY_LABEL = Object.fromEntries(
  TICKET_CATEGORIES.map((c) => [c.value, c.label])
);

export const ROLE_LABEL = {
  SUPER_ADMIN: 'مدیر کل',
  SUPPORT: 'پشتیبانی',
  FINANCE: 'مالی',
  AGENT: 'نماینده',
};
