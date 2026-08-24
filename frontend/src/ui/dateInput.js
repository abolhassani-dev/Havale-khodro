import { html, raw } from './html.js';
import { faDigits } from './format.js';
import { JALALI_MONTHS, toJalali, toGregorian, daysInJalaliMonth, todayJalali } from './jalali.js';

/**
 * A date the reader enters in their own calendar.
 *
 * ── Why three dropdowns and not a calendar popover ──────────────────────────
 *
 * A month grid is the prettier control, and it was the first plan. Two things
 * argued it down. It has to hang outside its field, and one of the two places
 * this is used is inside a modal whose body scrolls — an absolutely positioned
 * panel is clipped there, which is a bug that only appears in one of the two
 * screens and is easy to ship without noticing. And the dates being entered are
 * not "next Thursday", they are «۱۵ شهریور» — a number the agency already knows
 * and can pick in two touches, where a grid would make them page to the month
 * first.
 *
 * ── The contract with the form ──────────────────────────────────────────────
 *
 * A hidden input carries the value, and it carries it as `YYYY-MM-DD` in the
 * Gregorian calendar — exactly what `<input type="date">` used to hand back. So
 * `form.registerDeadline.value` still means the same thing to the code that
 * submits it, and nothing downstream of this file had to learn a new format.
 * Only the three dropdowns are Jalali, and they are what the reader sees.
 *
 * The dropdowns deliberately have no `name`: the form must have exactly one
 * field under this name, or `form.registerDeadline` stops being an input and
 * starts being a list of three.
 *
 * ── All DOM, no store ───────────────────────────────────────────────────────
 *
 * Same rule as the pickers next door. This lives inside a form, and a render
 * would wipe every other field the reader had filled in.
 */

const pad = (n) => String(n).padStart(2, '0');

/** A `Date` as the `YYYY-MM-DD` the hidden field carries. */
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * @param {string} name    the form field name
 * @param {object} [opts]
 * @param {string} [opts.value] current value as `YYYY-MM-DD`, or empty
 * @param {number} [opts.years] how many years forward to offer
 * @param {number} [opts.back]  how many years back to offer — a deadline looks
 *                              forward, a log filter looks back, and offering
 *                              both directions everywhere would put six dead
 *                              years in the one dropdown people use most
 * @param {string} [opts.labelId] id to put on the first control, for a <label for>
 */
export function jalaliDate(
  name,
  { value = '', years = 2, back = 0, labelId = `${name}-day` } = {}
) {
  const now = todayJalali();
  const set = value ? toJalali(value) : null;

  // A registration deadline is never five years out, and a log search is never
  // in the future — so each caller says which way it looks. An existing value
  // outside the window is still offered, so editing an old record cannot
  // silently move its date.
  // Built outward from this year so the likely answer is always near the top:
  // ۱۴۰۵ ۱۴۰۶ ۱۴۰۷ for a deadline, ۱۴۰۵ ۱۴۰۴ ۱۴۰۳ for a search.
  const list = [];
  for (let jy = now.jy + years; jy >= now.jy - back; jy -= 1) list.push(jy);
  if (!back) list.reverse();
  if (set && !list.includes(set.jy)) {
    list.push(set.jy);
    list.sort((a, b) => (back ? b - a : a - b));
  }

  const days = set ? daysInJalaliMonth(set.jy, set.jm) : 31;
  const chosen = (a, b) => raw(a === b ? 'selected' : '');

  return html`
  <div class="jdt" data-jdt>
    <input type="hidden" name="${name}" value="${value}">
    <div class="jdt-row">
      <select class="in" id="${labelId}" data-jdt-part="day" aria-label="روز">
        <option value="">روز</option>
        ${Array.from({ length: days }, (_, i) => i + 1).map(
          (d) => html`<option value="${d}" ${chosen(d, set?.jd)}>${faDigits(d)}</option>`
        )}
      </select>

      <select class="in" data-jdt-part="month" aria-label="ماه">
        <option value="">ماه</option>
        ${JALALI_MONTHS.map(
          (label, i) => html`<option value="${i + 1}" ${chosen(i + 1, set?.jm)}>${label}</option>`
        )}
      </select>

      <select class="in" data-jdt-part="year" aria-label="سال">
        <option value="">سال</option>
        ${list.map((jy) => html`<option value="${jy}" ${chosen(jy, set?.jy)}>${faDigits(jy)}</option>`)}
      </select>
    </div>
    <div class="jdt-warn" data-jdt-warn hidden>روز، ماه و سال را کامل کنید.</div>
  </div>`;
}

const partOf = (wrap, part) => wrap.querySelector(`[data-jdt-part="${part}"]`);

/**
 * Bring the hidden value, and the list of days, in line with what is chosen.
 *
 * The day list is rebuilt rather than left at 31 because Mehr has 30 days and
 * Esfand has 29 in most years: offering ۳۱ مهر and refusing it on submit is a
 * form arguing with the person filling it in. A day already chosen that the new
 * month does not have moves to that month's last day — the same thing every
 * native date control does.
 */
export function syncJalaliDate(wrap) {
  const day = partOf(wrap, 'day');
  const month = partOf(wrap, 'month');
  const year = partOf(wrap, 'year');
  const hidden = wrap.querySelector('input[type="hidden"]');

  const jm = Number(month.value) || 0;
  const jy = Number(year.value) || 0;
  const length = jm && jy ? daysInJalaliMonth(jy, jm) : 31;

  [...day.options].forEach((option) => {
    if (!option.value) return;
    option.hidden = Number(option.value) > length;
  });
  if (Number(day.value) > length) day.value = String(length);

  const jd = Number(day.value) || 0;
  const complete = jd && jm && jy;
  const gregorian = complete ? toGregorian(jy, jm, jd) : null;

  hidden.value = gregorian ? isoDay(gregorian) : '';
  // Nothing chosen at all is a legitimate answer — this field is optional
  // everywhere it is used. Half an answer is not, and saying so here is what
  // stops it from being silently dropped on submit.
  wrap.querySelector('[data-jdt-warn]').hidden = complete || !(jd || jm || jy);
}

/** Choosing a day, month or year. Returns true when it handled the change. */
export function handleJalaliDateChange(target) {
  if (!target?.matches?.('[data-jdt-part]')) return false;
  const wrap = target.closest('[data-jdt]');
  if (wrap) syncJalaliDate(wrap);
  return true;
}
