import { html, raw } from './html.js';
import { faDigits } from './format.js';

/**
 * Choosing which brands an account may post under.
 *
 * Used in three places — creating an agency, editing one, and creating a
 * sub-agency — and written once, because three copies of a 186-item picker is
 * three places for the select-all button to behave slightly differently.
 *
 * ── Why the selection lives in the DOM, not the store ───────────────────────
 *
 * The first version kept the ticked set in the store, which is the rule
 * everywhere else in this app — and here it was exactly wrong. Everything in
 * the store re-renders the page when it changes, and this picker sits *inside
 * a form*: ticking «پژو» re-rendered the page and wiped the nine fields the
 * admin had just typed. The sidebar lesson (state must survive re-renders)
 * does not apply, because the fix here is that ticking must not *cause* a
 * re-render — a checkbox already remembers itself, and the browser is the one
 * place the user's half-finished typing also lives. So: native checkbox state,
 * DOM-only updates for the count and the highlight, and the form reads the
 * boxes back out at submit time, exactly like every other input it owns.
 *
 * ── Why the company is only a heading ───────────────────────────────────────
 *
 * Ticking a company ticks its brands, and what gets submitted is always the
 * brands. The company grouping was assembled by hand and will sometimes be
 * wrong; were the grant stored as "this company", correcting a grouping later
 * would silently change who may post what. Stored as brands, a correction is
 * only ever a correction.
 */

/** Groups the brands for display: named companies first, then the rest. */
function group(brands) {
  const byCompany = new Map();
  const loose = [];

  for (const brand of brands) {
    if (!brand.company) {
      loose.push(brand);
      continue;
    }
    if (!byCompany.has(brand.company.id)) {
      byCompany.set(brand.company.id, { name: brand.company.name, items: [] });
    }
    byCompany.get(brand.company.id).items.push(brand);
  }

  const groups = [...byCompany.values()];
  // Last, and named — it is where most brands live, and calling it what it is
  // beats leaving a heap of unlabelled rows below the tidy part.
  if (loose.length) groups.push({ name: 'دسته‌بندی‌نشده', items: loose });
  return groups;
}

/**
 * The picker.
 *
 * @param {Array}  brands            every brand on offer — already narrowed to
 *                                   the parent's own list when a parent chooses
 * @param {object} [options]
 * @param {string} [options.note]     one line explaining the ceiling, if any
 * @param {Array}  [options.selected] brand ids to start ticked
 */
export function brandPicker(brands, { note = '', selected = [] } = {}) {
  const on = new Set(selected);

  return html`
  <div class="bpick" data-bpick>
    <div class="bpick-h">
      <div>
        <b>برندهای مجاز برای ثبت آگهی</b>
        <div class="hint" data-brand-count>${countLabel(on.size)}</div>
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
      ${group(brands).map(
        (g) => html`
        <div class="bpick-group">
          <label class="bpick-ghead">
            <input type="checkbox" data-brand-group
                   ${raw(g.items.every((b) => on.has(b.id)) ? 'checked' : '')}>
            <b>${g.name}</b>
            <span class="sub">${faDigits(g.items.length)}</span>
          </label>
          <div class="bpick-items">
            ${g.items.map(
              (b) => html`<label class="bpick-item ${on.has(b.id) ? 'on' : ''}"
                                 data-bname="${b.name} ${b.slug || ''}">
                <input type="checkbox" data-brand="${b.id}" ${raw(on.has(b.id) ? 'checked' : '')}>
                ${
                  b.logo
                    ? html`<img src="/assets/brands/${b.logo}" alt="" loading="lazy">`
                    : html`<span class="bpick-nologo"></span>`
                }
                <span class="bpick-name">${b.name}</span>
              </label>`
            )}
          </div>
        </div>`
      )}
    </div>
  </div>`;
}

function countLabel(n) {
  return n
    ? `${faDigits(n)} برند انتخاب شده`
    : 'هیچ برندی انتخاب نشده — این حساب نمی‌تواند آگهی ثبت کند.';
}

/** The picker on screen. There is never more than one at a time. */
function root(scope = document) {
  return scope.querySelector?.('[data-bpick]') || null;
}

/**
 * The ticked brand ids, read back out of the boxes the way a form reads inputs.
 *
 * Read from `scope` — the submitted form — and not from the document, for a
 * reason that only bites in modals: `runModalAction` re-renders the modal (to
 * show its busy state) *before* calling onSubmit, so by the time this runs the
 * picker in the document is a fresh copy with the initial ticks. The form the
 * submit event carried is detached but intact, holding what the user actually
 * chose — which is exactly how the modal's text inputs already survive the
 * same re-render.
 */
export function brandPickValue(scope = document) {
  const el = root(scope);
  if (!el) return [];
  return [...el.querySelectorAll('input[data-brand]:checked')].map((b) => b.dataset.brand);
}

/**
 * Brings the derived bits back in line after any change: the count line, the
 * per-item highlight, and each group head's checkbox. All textContent and
 * classList — nothing here may touch the store, or the form dies with it.
 */
function sync(el) {
  el.querySelectorAll('.bpick-item').forEach((item) => {
    item.classList.toggle('on', item.querySelector('input').checked);
  });
  el.querySelectorAll('.bpick-group').forEach((g) => {
    const boxes = [...g.querySelectorAll('input[data-brand]')];
    g.querySelector('input[data-brand-group]').checked = boxes.every((b) => b.checked);
  });
  const count = el.querySelector('[data-brand-count]');
  if (count) count.textContent = countLabel(el.querySelectorAll('input[data-brand]:checked').length);
}

/** The «همه» / «هیچ‌کدام» buttons. Returns true when the click was ours. */
export function handleBrandPickClick(d) {
  if (d.brandAll === undefined && d.brandNone === undefined) return false;
  const el = root();
  if (!el) return false;

  const on = d.brandAll !== undefined;
  el.querySelectorAll('input[data-brand]').forEach((b) => {
    b.checked = on;
  });
  sync(el);
  return true;
}

/**
 * A checkbox changed. Driven by `change` and never by `click`: a click on a
 * <label> wrapping an input fires twice — once for the label, once for the
 * input the browser forwards it to — and a click-driven toggle would flip the
 * box and flip it straight back.
 */
export function handleBrandPickChange(target) {
  const el = root();
  if (!el || !el.contains(target)) return false;

  if (target.matches('input[data-brand-group]')) {
    // The whole group follows its head — the filtered-out members included,
    // because «همه‌ی مدیران خودرو» means the company, not the search results.
    target
      .closest('.bpick-group')
      .querySelectorAll('input[data-brand]')
      .forEach((b) => {
        b.checked = target.checked;
      });
  } else if (!target.matches('input[data-brand]')) {
    return false;
  }

  sync(el);
  return true;
}

/**
 * The search box. Show and hide, never re-render: the boxes hold the
 * selection, so rebuilding the list would throw the ticks away — and hiding is
 * also what makes «همه» while filtered stay honest, since the hidden items are
 * still there to be counted.
 */
export function handleBrandPickSearch(input) {
  if (!input.matches?.('[data-brand-search]')) return false;
  const el = root();
  if (!el) return false;

  const q = input.value.trim().toLowerCase();
  el.querySelectorAll('.bpick-group').forEach((g) => {
    let visible = 0;
    g.querySelectorAll('.bpick-item').forEach((item) => {
      const hit = !q || item.dataset.bname.toLowerCase().includes(q);
      item.style.display = hit ? '' : 'none';
      if (hit) visible += 1;
    });
    g.style.display = visible ? '' : 'none';
  });
  return true;
}
