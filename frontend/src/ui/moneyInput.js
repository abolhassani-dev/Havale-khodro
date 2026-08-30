import { html, raw } from './html.js';

/**
 * A price field that groups its digits as you type: ۱۲۳٬۴۵۶٬۷۸۹.
 *
 * Prices here run to nine and ten digits. Unspaced, «۱۲۰۰۰۰۰۰۰» and
 * «۱۲۰۰۰۰۰۰» look the same at a glance, and the difference between them is a
 * factor of ten on a car. Everywhere the panel *shows* money it already groups
 * it; this is the one place that did not, which is exactly the place where a
 * mistake is still possible.
 *
 * Two inputs, one visible: the one you type into carries the grouped Persian
 * text, and a hidden sibling carries the bare ASCII digits under the real
 * `name`. So every reader — `form.elements.amountToman.value`, FormData, a page
 * written next year — gets `120000000` without knowing this component exists.
 * The same split the Jalali date picker uses, for the same reason.
 */

const FA = '۰۱۲۳۴۵۶۷۸۹';
const AR = '٠١٢٣٤٥٦٧٨٩';
const SEP = '٬'; // U+066C, the Arabic thousands separator — not a Latin comma.

/**
 * Just the digits, with Persian and Arabic ones folded down to ASCII.
 *
 * A phone keypad on an Iranian handset sends Persian digits, and a paste from
 * a price list can bring either kind plus separators and a «تومان». All of it
 * is thrown away except the digits.
 */
export function digitsOf(text) {
  let out = '';
  for (const ch of String(text ?? '')) {
    if (ch >= '0' && ch <= '9') {
      out += ch;
      continue;
    }
    const fa = FA.indexOf(ch);
    if (fa >= 0) {
      out += String(fa);
      continue;
    }
    const ar = AR.indexOf(ch);
    if (ar >= 0) out += String(ar);
  }
  return out;
}

/** Bare ASCII digits in, grouped Persian digits out. */
export function groupMoney(digits) {
  const trimmed = digits.replace(/^0+(?=\d)/, '');
  return trimmed
    .replace(/\B(?=(\d{3})+(?!\d))/g, SEP)
    .replace(/[0-9]/g, (d) => FA[Number(d)]);
}

const isDigitChar = (ch) => (ch >= '0' && ch <= '9') || FA.includes(ch);

/**
 * The id the label must point at, given the field name.
 *
 * The visible input cannot be `id="amountToman"` while its hidden twin is
 * `name="amountToman"`: a form looks its children up by name *or* id, so both
 * would answer to `form.amountToman`, which then returns a list rather than an
 * element and reads as the empty string. Every price was posted blank, and the
 * server said the field was required — of a form that plainly had it filled in.
 */
export const moneyFieldId = (name) => `${name}-in`;

/**
 * The markup. `name` lands on the hidden input, so the form contract is
 * unchanged; the visible input carries the id the label points at.
 */
export function moneyInput(name, { required = false, placeholder = '', value = '', id } = {}) {
  const digits = digitsOf(value);
  return html`<span class="mny" data-money-wrap>
    <input class="in num" id="${id || moneyFieldId(name)}" inputmode="numeric" autocomplete="off" data-money
           placeholder="${placeholder}" value="${digits ? groupMoney(digits) : ''}"
           ${raw(required ? 'required' : '')}>
    <input type="hidden" name="${name}" value="${digits}">
  </span>`;
}

/**
 * Re-groups one field after a keystroke and copies the digits to the hidden
 * twin. Returns true when it handled the event.
 *
 * The caret is put back by counting digits, not characters: inserting a
 * separator to the left of the cursor would otherwise push the cursor one place
 * left on every fourth keystroke, which feels like the field fighting you.
 */
export function handleMoneyInput(input) {
  if (!input?.matches?.('[data-money]')) return false;

  const before = input.value;
  const caret = input.selectionStart ?? before.length;
  const digitsBefore = digitsOf(before.slice(0, caret)).length;

  const digits = digitsOf(before);
  input.value = digits ? groupMoney(digits) : '';

  const hidden = input.closest('[data-money-wrap]')?.querySelector('input[type="hidden"]');
  if (hidden) hidden.value = digits;

  let seen = 0;
  let pos = 0;
  while (pos < input.value.length && seen < digitsBefore) {
    if (isDigitChar(input.value[pos])) seen += 1;
    pos += 1;
  }
  // Only when it is focused: setSelectionRange on a background field steals
  // the caret away from wherever the person actually is.
  if (document.activeElement === input) input.setSelectionRange(pos, pos);
  return true;
}
