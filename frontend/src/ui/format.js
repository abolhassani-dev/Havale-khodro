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
  OTHER: 'سایر',
};

export const REPORT_STATUS_LABEL = {
  PENDING: 'در انتظار بررسی',
  CONFIRMED: 'تخلف تأیید شد',
  REJECTED: 'رد شد',
  ABUSIVE: 'گزارش بی‌مورد',
};

export const TICKET_STATUS_LABEL = { OPEN: 'باز', ANSWERED: 'پاسخ داده شد', CLOSED: 'بسته' };

export const TICKET_PRIORITY_LABEL = { LOW: 'کم', NORMAL: 'عادی', HIGH: 'زیاد' };

export const ROLE_LABEL = {
  SUPER_ADMIN: 'مدیر کل',
  SUPPORT: 'پشتیبانی',
  FINANCE: 'مالی',
  AGENT: 'نماینده',
};
