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
 * So it folds. Native `<details>`: no click key, no store entry, no state to
 * keep in sync with a re-render — and the panel opens itself whenever a
 * filter is on, so nobody hunts for why a list came back short. On a wide
 * screen there is room for both and the handle is hidden in CSS, with the
 * page deciding openness from the viewport (see `wideScreen`) because a
 * closed <details> hides its contents with `content-visibility`, which no
 * override on the child can reach.
 */
export function filterBox(active, body) {
  return html`<details class="filters-box" ${raw(wideScreen() || active ? 'open' : '')}>
    <summary>
      فیلترها
      ${active ? html`<span class="tag">${faDigits(active)} فعال</span>` : ''}
    </summary>
    ${body}
  </details>`;
}

/** The same 721px the stylesheet calls «not a phone». */
export function wideScreen() {
  return typeof window !== 'undefined' && window.innerWidth >= 721;
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
