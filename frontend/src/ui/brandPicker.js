import { html, raw } from './html.js';
import { faDigits } from './format.js';
import { catalog } from '../api/index.js';

/**
 * Choosing what an account may post under: whole brands, or single models.
 *
 * Used in three places — creating an agency, editing one, and creating a
 * sub-agency — and written once, because three copies of a 186-item picker is
 * three places for the select-all button to behave slightly differently.
 *
 * ── Two grains ───────────────────────────────────────────────────────────────
 *
 * Ticking a brand grants the brand: every model it has, and every model it
 * gains later. Opening a brand («مدل‌ها») and ticking single models grants
 * exactly those — for the agency whose whole job is one Fownix. The brand box
 * shows the difference: checked is the whole brand, a count badge is a partial
 * one.
 *
 * ── Why the selection lives in the DOM, not the store ───────────────────────
 *
 * The first version kept the ticked set in the store, which is the rule
 * everywhere else in this app — and here it was exactly wrong. Everything in
 * the store re-renders the page when it changes, and this picker sits *inside
 * a form*: ticking «پژو» re-rendered the page and wiped the nine fields the
 * admin had just typed. So: native checkbox state, DOM-only updates for the
 * count and the highlight, and the form reads the boxes back out at submit
 * time, exactly like every other input it owns.
 *
 * Model lists arrive by their own request when a brand is opened — the same
 * lazy endpoint the forms use, because shipping 2044 models with the picker is
 * how the catalogue payload got heavy in the first place.
 */

/**
 * @param {Array}  brands   every brand on offer — already narrowed to the
 *                          parent's own when a parent is choosing
 * @param {object} [options]
 * @param {string} [options.note]           one line explaining the ceiling
 * @param {Array}  [options.selected]       brand ids to start fully ticked
 * @param {Array}  [options.selectedModels] [{id, brandId}] single-model grants
 * @param {object} [options.modelCeiling]   {brandId: [modelIds]} — a parent's
 *                          partial brands: only these models may be offered
 */
export function brandPicker(
  brands,
  { note = '', selected = [], selectedModels = [], modelCeiling = null } = {}
) {
  const on = new Set(selected);

  const grantsByBrand = {};
  for (const g of selectedModels) {
    (grantsByBrand[g.brandId] = grantsByBrand[g.brandId] || []).push(g.id);
  }

  return html`
  <div class="bpick" data-bpick
       data-ceiling="${modelCeiling ? JSON.stringify(modelCeiling) : ''}">
    <div class="bpick-h">
      <div>
        <b>برندها و مدل‌های مجاز برای ثبت آگهی</b>
        <div class="hint" data-brand-count>${countLabel(on.size, selectedModels.length)}</div>
      </div>
      <div class="row-actions">
        <button type="button" class="btn sm" data-brand-all>همه</button>
        <button type="button" class="btn sm" data-brand-none>هیچ‌کدام</button>
      </div>
    </div>

    ${note ? html`<div class="hint bpick-note">${note}</div>` : ''}

    <input class="in bpick-q" type="search" data-brand-search
           placeholder="جستجوی برند — مثلاً پژو یا peugeot" aria-label="جستجوی برند">

    <div class="bpick-body">
      <div class="bpick-items">
        ${brands.map((b) => {
          const grants = grantsByBrand[b.id] || [];
          const nModels = b._count?.models;
          return html`<div class="bpick-cell ${on.has(b.id) ? 'on' : grants.length ? 'part' : ''}"
                           data-cell data-brand-id="${b.id}"
                           data-bname="${b.name} ${b.slug || ''}"
                           data-grants="${grants.join(',')}">
            <div class="bpick-row">
              <label class="bpick-item">
                <input type="checkbox" data-brand="${b.id}" ${raw(on.has(b.id) ? 'checked' : '')}>
                ${
                  b.logo
                    ? html`<img src="/assets/brands/${b.logo}" alt="" loading="lazy">`
                    : html`<span class="bpick-nologo">${(b.name || '؟').slice(0, 1)}</span>`
                }
                <span class="bpick-name">${b.name}</span>
                <span class="bpick-badge" data-badge>
                  ${grants.length && !on.has(b.id) ? `${faDigits(grants.length)} مدل` : ''}
                </span>
              </label>
              <button type="button" class="bpick-x" data-brand-expand="${b.id}"
                      aria-label="مدل‌های ${b.name}">
                <span>مدل‌ها</span>${nModels ? html`<i>${faDigits(nModels)}</i>` : ''}<span class="bpick-chev" aria-hidden="true"></span>
              </button>
            </div>
            <div class="bpick-mlist" hidden data-mlist></div>
          </div>`;
        })}
      </div>
    </div>
  </div>`;
}

function countLabel(nBrands, nModels) {
  if (!nBrands && !nModels) return 'چیزی انتخاب نشده — این حساب نمی‌تواند آگهی ثبت کند.';
  const parts = [];
  if (nBrands) parts.push(`${faDigits(nBrands)} برند کامل`);
  if (nModels) parts.push(`${faDigits(nModels)} مدل تکی`);
  return `${parts.join(' و ')} انتخاب شده`;
}

/** The picker on screen. There is never more than one at a time. */
function root(scope = document) {
  return scope.querySelector?.('[data-bpick]') || null;
}

/**
 * What a cell contributes when its brand is not fully ticked.
 *
 * From the boxes when the reader has opened or touched the cell; from the
 * initial grants otherwise — a partial brand nobody opened must keep exactly
 * the models it arrived with, not silently lose them because the list was
 * never fetched.
 */
function cellModelIds(cell) {
  if (cell.dataset.touched || !cell.querySelector('[data-mlist]').hidden) {
    return [...cell.querySelectorAll('input[data-model]:checked')].map((b) => b.dataset.model);
  }
  return cell.dataset.grants ? cell.dataset.grants.split(',').filter(Boolean) : [];
}

/**
 * The ceiling on this cell's brand, when the chooser is working under one —
 * the models a parent holds of a brand it does not hold whole. Null means the
 * brand can be granted in full.
 */
function ceilingOf(el, cell) {
  const rawMap = el.dataset.ceiling;
  if (!rawMap) return null;
  return JSON.parse(rawMap)[cell.dataset.brandId] || null;
}

/**
 * What a ticked brand box means for a ceiling-limited brand: every model the
 * ceiling allows — read from the boxes when the list has been fetched (the
 * brand box drives them), and from the ceiling itself when it has not.
 * The whole brand is not the parent's to give, so it is never sent.
 */
function cappedSelection(cell, cap) {
  if (cell.querySelector('[data-mlist]').dataset.loaded) {
    return [...cell.querySelectorAll('input[data-model]:checked')].map((b) => b.dataset.model);
  }
  return cap;
}

/**
 * The ticked grants, read back out the way a form reads inputs.
 *
 * Read from `scope` — the submitted form — and not from the document, for a
 * reason that only bites in modals: `runModalAction` re-renders the modal (to
 * show its busy state) *before* calling onSubmit, so by then the picker in the
 * document is a fresh copy with the initial ticks. The form the submit event
 * carried is detached but intact, exactly how the modal's text inputs survive
 * the same re-render.
 */
export function brandPickValue(scope = document) {
  const el = root(scope);
  if (!el) return { brandIds: [], modelIds: [] };

  const brandIds = [];
  const modelIds = [];
  el.querySelectorAll('[data-cell]').forEach((cell) => {
    const cap = ceilingOf(el, cell);
    if (cell.querySelector('input[data-brand]').checked) {
      // Under a ceiling the brand box means "all the models I may give" and
      // is sent as those models. Sent as the brand, the server rightly
      // refused it — the whole brand is more than the parent holds — and the
      // reader was told no for the very thing the screen offered them.
      if (cap) modelIds.push(...cappedSelection(cell, cap));
      else brandIds.push(cell.dataset.brandId);
    } else {
      modelIds.push(...cellModelIds(cell));
    }
  });
  return { brandIds, modelIds };
}

/** Brings the count line, highlights and badges back in line after a change. */
function sync(el) {
  let fullBrands = 0;
  let singleModels = 0;

  el.querySelectorAll('[data-cell]').forEach((cell) => {
    const box = cell.querySelector('input[data-brand]');
    const badge = cell.querySelector('[data-badge]');
    const cap = ceilingOf(el, cell);

    // Under a ceiling a ticked brand box is still a set of models — counted,
    // shown and eventually saved as models, never as the whole brand.
    let models = [];
    let whole = false;
    if (box.checked && cap) models = cappedSelection(cell, cap);
    else if (box.checked) whole = true;
    else models = cellModelIds(cell);

    if (whole) fullBrands += 1;
    singleModels += models.length;

    box.indeterminate = !box.checked && models.length > 0;
    cell.classList.toggle('on', whole);
    cell.classList.toggle('part', !whole && models.length > 0);
    badge.textContent = !whole && models.length ? `${faDigits(models.length)} مدل` : '';
  });

  const count = el.querySelector('[data-brand-count]');
  if (count) count.textContent = countLabel(fullBrands, singleModels);
}

/** The buttons: «همه», «هیچ‌کدام», and opening a brand's models. */
export function handleBrandPickClick(d) {
  if (d.brandExpand) return expand(d.brandExpand);
  if (d.brandAll === undefined && d.brandNone === undefined) return false;

  const el = root();
  if (!el) return false;
  const on = d.brandAll !== undefined;

  el.querySelectorAll('[data-cell]').forEach((cell) => {
    cell.dataset.touched = '1';
    cell.querySelector('input[data-brand]').checked = on;
    cell.querySelectorAll('input[data-model]').forEach((b) => {
      b.checked = on;
    });
    // Either way the initial partial grants are overridden: «همه» made them
    // redundant, «هیچ‌کدام» means none — keeping them would resurrect models
    // the reader just cleared.
    cell.dataset.grants = '';
  });
  sync(el);
  return true;
}

/**
 * Opens a brand's model list, fetching it on first open.
 *
 * All DOM. The boxes render checked when the brand is fully ticked or the
 * model is individually granted, and a parent's ceiling — the only models it
 * may hand down of a brand it holds partially — filters the list before it is
 * shown, because offering a model the server will refuse is offering a 403.
 */
async function expand(brandId) {
  const el = root();
  const cell = el?.querySelector(`[data-cell][data-brand-id="${brandId}"]`);
  if (!cell) return true;

  const list = cell.querySelector('[data-mlist]');
  if (!list.hidden) {
    list.hidden = true;
    cell.classList.remove('open');
    return true;
  }

  // Accordion: opening one closes the others. Nothing is lost by hiding —
  // touched cells are read from their boxes even while hidden, untouched ones
  // from their initial grants — and one open list at a time is the difference
  // between a readable page and the mess this picker used to be.
  el.querySelectorAll('[data-cell].open').forEach((other) => {
    other.querySelector('[data-mlist]').hidden = true;
    other.classList.remove('open');
  });

  cell.classList.add('open');
  list.hidden = false;
  if (list.dataset.loaded) return true;

  list.textContent = 'در حال بارگذاری…';
  let models;
  try {
    ({ models } = await catalog.brandModels(brandId));
  } catch {
    list.textContent = 'بارگذاری نشد — دوباره روی «مدل‌ها» بزنید.';
    list.hidden = true;
    cell.classList.remove('open');
    return true;
  }

  const ceilingRaw = el.dataset.ceiling;
  if (ceilingRaw) {
    const ceiling = JSON.parse(ceilingRaw);
    if (ceiling[brandId]) {
      const mine = new Set(ceiling[brandId]);
      models = models.filter((m) => mine.has(m.id));
    }
  }

  const brandChecked = cell.querySelector('input[data-brand]').checked;
  const granted = new Set(cell.dataset.grants.split(',').filter(Boolean));

  if (!models.length) {
    list.textContent = 'مدلی برای انتخاب نیست.';
    list.dataset.loaded = '1';
    return true;
  }

  list.textContent = '';
  for (const m of models) {
    const label = document.createElement('label');
    label.className = 'bpick-model';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.dataset.model = m.id;
    box.checked = brandChecked || granted.has(m.id);
    const name = document.createElement('span');
    name.textContent = m.name; // operator text — never markup
    label.append(box, name);
    list.appendChild(label);
  }
  list.dataset.loaded = '1';
  return true;
}

/**
 * A checkbox changed. Driven by `change` and never by `click`: a click on a
 * label wrapping an input fires twice, and the second undoes the first.
 */
export function handleBrandPickChange(target) {
  const el = root();
  if (!el || !el.contains(target)) return false;

  const cell = target.closest('[data-cell]');
  if (!cell) return false;

  if (target.matches('input[data-brand]')) {
    cell.dataset.touched = '1';
    cell.dataset.grants = '';
    // The whole brand follows its box — the model list included, whichever
    // direction it went.
    cell.querySelectorAll('input[data-model]').forEach((b) => {
      b.checked = target.checked;
    });
  } else if (target.matches('input[data-model]')) {
    cell.dataset.touched = '1';
    // Ticking every model by hand is granting the brand — and it is stored as
    // the brand, so models added later follow. Anything less stays per-model.
    const boxes = [...cell.querySelectorAll('input[data-model]')];
    cell.querySelector('input[data-brand]').checked =
      boxes.length > 0 && boxes.every((b) => b.checked);
  } else {
    return false;
  }

  sync(el);
  return true;
}

/**
 * The search box. Show and hide, never re-render: the boxes hold the
 * selection, so rebuilding the list would throw the ticks away.
 */
export function handleBrandPickSearch(input) {
  if (!input.matches?.('[data-brand-search]')) return false;
  const el = root();
  if (!el) return false;

  const q = input.value.trim().toLowerCase();
  el.querySelectorAll('[data-cell]').forEach((cell) => {
    cell.style.display = !q || cell.dataset.bname.toLowerCase().includes(q) ? '' : 'none';
  });
  return true;
}
