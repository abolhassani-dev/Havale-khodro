import { html } from './html.js';
import { icon } from './icons.js';
import { until } from './format.js';

/**
 * Who posted it and how long it has left — as labelled rows, like every other
 * fact on the card.
 *
 * These used to be a loose line of grey words under the specifications:
 * «نمایندگی پارس   G-1002   تهران   ۶ روز دیگر», four values with nothing
 * saying which was which. On a card whose every other line reads «عنوان:
 * پاسخ» that line was the one piece of furniture out of place, and the same
 * line sat on all three markets.
 *
 * Rendered as `<dl>` rows so it can be appended straight to a card's own
 * specification list.
 */
export function metaRows(item) {
  const rows = [];
  if (item.agency) {
    if (item.agency.name) rows.push(['نمایندگی', item.agency.name]);
    if (item.agency.code) rows.push(['کد نمایندگی', item.agency.code]);
    if (item.agency.city) rows.push(['شهر', item.agency.city]);
  }
  rows.push(['مهلت آگهی', until(item.closesAt)]);

  return html`${rows.map(
    ([label, value]) => html`<div><dt>${label}</dt><dd class="num">${value}</dd></div>`
  )}`;
}

/**
 * What is still behind the reveal, for a card that has not been paid for.
 *
 * One sentence, once. The card used to say it in the grey line and again on
 * the contact strip, which reads as a bug rather than as emphasis.
 */
export function lockNote(what) {
  return html`<p class="masked-id">
    ${icon('lock', 12)} ${what} محرمانه است — با «نمایش مشخصات» باز می‌شود.
  </p>`;
}
