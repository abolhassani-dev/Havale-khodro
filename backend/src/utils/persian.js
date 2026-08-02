/**
 * Persian digits.
 *
 * Everything a user reads in this system is Persian, and a sentence that reads
 * «۱ از ۳» with Latin numerals in the middle looks like a bug to the person
 * receiving it — because it is one.
 *
 * The deliberate exception is a code the user has to type back: a one-time
 * password or a reset code stays in Latin digits, because the field they type it
 * into takes Latin digits and phones autofill Latin digits. Prettier numerals
 * there would mean transcribing by hand, which is exactly the moment people give
 * up.
 */

const PERSIAN_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

function toPersianDigits(value) {
  return String(value).replace(/[0-9]/g, (d) => PERSIAN_DIGITS[Number(d)]);
}

/** A price with thousands separators, in Persian numerals. */
function formatToman(amount) {
  return toPersianDigits(Number(amount).toLocaleString('en-US'));
}

module.exports = { toPersianDigits, formatToman };
