import { html, raw } from './html.js';
import { faDigits } from './format.js';
import { brandPicker } from './brandPicker.js';

/**
 * «برند و مدل» as a filter: one line until it is opened.
 *
 * The picker underneath is the one the admin panel grants brands with, and it
 * answers the question a filter needs — several whole brands, or single
 * models inside them, in one search. What it must not do is arrive open: a
 * hundred and eighty brands unfolded above the year and price fields is a
 * catalogue where a filter panel should be, and the reader has to scroll past
 * all of it to reach the rest of the filters.
 *
 * So it is a line that says what is chosen, and opens only when asked — or by
 * itself when something is already ticked, because a filter that is on and
 * invisible is how a short list gets blamed on an empty market.
 */
export function brandFilter(brands, { brandIds = '', pickedModels = [] } = {}) {
  const picked = brandIds ? brandIds.split(',').filter(Boolean) : [];
  const any = picked.length + pickedModels.length;

  return html`<details class="pick-fold" ${raw(any ? 'open' : '')}>
    <summary>
      برند و مدل
      <span class="tag">${chosen(picked.length, pickedModels.length)}</span>
    </summary>
    ${brandPicker(brands, {
      title: 'برند و مدل',
      emptyLabel: 'چیزی انتخاب نشده — یعنی همه‌ی برندها و مدل‌ها.',
      selected: picked,
      selectedModels: pickedModels,
    })}
  </details>`;
}

function chosen(nBrands, nModels) {
  if (!nBrands && !nModels) return 'همه';
  const parts = [];
  if (nBrands) parts.push(`${faDigits(nBrands)} برند`);
  if (nModels) parts.push(`${faDigits(nModels)} مدل`);
  return parts.join(' و ');
}
