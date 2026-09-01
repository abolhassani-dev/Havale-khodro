import { html, raw } from './html.js';
import { faDigits } from './format.js';

/**
 * The filters of a market, behind one control.
 *
 * All three markets had the same shape: a panel of ten or twelve fields
 * pinned open above the results. On a phone that panel *was* the first
 * screen — an agency arrived at «استعلام» and saw a form, not a market, and
 * had to scroll past everything it could ask before reaching a single
 * advertisement.
 *
 * So it folds — on every screen, not only the small ones. A desk is not a
 * reason to give a form the top of the page either; the answer is what the
 * page is for. Native `<details>`: no click key, no store entry, no state to
 * keep in sync with a re-render. It opens itself only when a filter is
 * actually on, so a short list is never blamed on an empty market.
 */
export function filterBox(active, body) {
  return html`<details class="filters-box" ${raw(active ? 'open' : '')}>
    <summary>
      فیلترها
      ${active ? html`<span class="tag">${faDigits(active)} فعال</span>` : ''}
    </summary>
    ${body}
  </details>`;
}

/**
 * How many filters are on — the number the summary shows.
 *
 * Counts keys that are actually filters: the tab, the order and the page are
 * navigation, and counting them would tell an agency it has three filters on
 * when it has none.
 */
export function countFilters(params, keys) {
  return keys.filter((key) => params[key]).length;
}
