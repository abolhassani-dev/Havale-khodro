/**
 * The Iranian calendar.
 *
 * Everything this product *shows* has been Jalali from the start — `date()` in
 * format.js formats with `fa-IR-u-ca-persian`. What was still Gregorian was
 * everything the reader *typed*: `<input type="date">` opens the browser's own
 * picker, and no browser has a Persian one. So an agency entering a deadline of
 * ۱۵ شهریور ۱۴۰۵ had to convert it in their head to 6 September 2026, type
 * that, and then be shown ۱۵ شهریور ۱۴۰۵ back. The conversion is exactly the
 * work a computer should be doing.
 *
 * ── Why there is no conversion table in this file ───────────────────────────
 *
 * The usual way to do this is to vendor the 33-year leap cycle and its list of
 * cycle breaks — a hundred lines of integer arithmetic nobody in this project
 * can check by reading. The browser already has the calendar: `Intl` converts
 * Gregorian → Jalali exactly, and it is the same implementation that renders
 * every date in the interface. So that is the one used here, and the other
 * direction is a guess-and-correct against it.
 *
 * The consequence worth having: what the picker accepts and what the panel
 * displays can never disagree, because they are the same calendar.
 */

const PARTS = new Intl.DateTimeFormat('en-US-u-ca-persian', {
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
});

export const JALALI_MONTHS = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند',
];

/** A Gregorian `Date` as {jy, jm, jd}, in the reader's own time zone. */
export function toJalali(value) {
  const parts = PARTS.formatToParts(new Date(value));
  const of = (type) => Number(parts.find((p) => p.type === type)?.value);
  return { jy: of('year'), jm: of('month'), jd: of('day') };
}

/**
 * Day of the Jalali year, 1-based.
 *
 * Exact by construction: the first six months are 31 days and the next five are
 * 30, with no exceptions. Only Esfand varies, and it is last, so it never
 * shifts anything.
 */
function dayOfYear(jm, jd) {
  return (jm <= 6 ? (jm - 1) * 31 : 186 + (jm - 7) * 30) + jd;
}

/**
 * Jalali → Gregorian, or null if that date does not exist (31 Mehr, or
 * 30 Esfand of an ordinary year).
 *
 * Nowruz is 20 or 21 March, so counting forward from 21 March lands within a
 * couple of days; the loop then asks `Intl` where it actually landed and steps
 * by the difference. It converges in one or two passes — the bound is only
 * there so a wrong answer can never become a hung tab.
 *
 * Noon rather than midnight: an hour of daylight-saving drift on either side
 * still leaves the date on the day it belongs to.
 */
export function toGregorian(jy, jm, jd) {
  const target = dayOfYear(jm, jd);
  const found = new Date(jy + 621, 2, 21, 12);
  found.setDate(found.getDate() + target - 1);

  for (let pass = 0; pass < 8; pass += 1) {
    const at = toJalali(found);
    if (at.jy === jy && at.jm === jm && at.jd === jd) return found;
    // 366 as the year's length, not 365.25: it makes the estimate wrong by at
    // most a day when the guess has crossed a year boundary, and — the part
    // that matters — never wrong by exactly zero, which would read as "we are
    // already there" and stop one day short.
    const drift = (at.jy - jy) * 366 + dayOfYear(at.jm, at.jd) - target;
    if (!drift) return null;
    found.setDate(found.getDate() - drift);
  }
  return null;
}

/**
 * How long a Jalali month is.
 *
 * Esfand is asked, not calculated: the distance between two consecutive
 * Nowruzes is 365 days or 366, and the 366 is the leap year. One subtraction
 * instead of a leap rule this file would have to be trusted to have got right.
 */
export function daysInJalaliMonth(jy, jm) {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  const nowruz = toGregorian(jy, 1, 1);
  const next = toGregorian(jy + 1, 1, 1);
  if (!nowruz || !next) return 29;
  return Math.round((next - nowruz) / 86400000) === 366 ? 30 : 29;
}

/** Today, as the reader's calendar has it. */
export function todayJalali() {
  return toJalali(new Date());
}
