import { html, raw } from '../../ui/html.js';
import { carPrices } from '../../api/index.js';
import { getState } from '../../state/store.js';
import { faDigits, enDigits, num, dateTime } from '../../ui/format.js';
import { toast, emptyBox, qtip } from '../../ui/feedback.js';
import { filterBox, countFilters } from '../../ui/filterBox.js';
import { icon } from '../../ui/icons.js';
import { go } from '../../router.js';

/**
 * The market price list — «قیمت روز خودروها».
 *
 * Read from our own hourly snapshot, never from the source: the page is a
 * database read, and however many agencies open it at once, the source sees
 * two requests an hour. The whole list (both groups, ~250 rows, a few tens of
 * kilobytes) comes in one request and is kept for five minutes, so switching
 * tab, brand or sort re-renders from memory and costs nothing.
 *
 * Two layers, because 115 rows is a wall and a dealer thinks in models:
 *
 *   «فهرست من» — the cars this agency starred, always on top, and simply not
 *   rendered while it is empty (the stars on the rows are the invitation).
 *
 *   the list — one brand at a time (chips), and within it one row per MODEL
 *   with the price range across its trims; the trims open under it. «دنا
 *   پلاس» is three rows on the source and one here until it is opened.
 *
 * Search is live and client-side: rows carry a normalised copy of their name
 * and the handler hides what does not match, across every brand. Filters and
 * sort go through the address bar like every other list here, so a search
 * can be sent as a link.
 *
 * Everything printed here came from somebody else's website. It goes through
 * the `html` tag like all other text, and nothing from it is ever used as a
 * selector or an attribute without escaping.
 */

const TTL_MS = 5 * 60 * 1000;
let cache = null;

const GROUP_FA = { DOMESTIC: 'تولید داخل', IMPORTED: 'وارداتی' };
const SORTS = [
  ['src', 'ترتیب منبع'],
  ['change', 'بیشترین تغییر'],
  ['expensive', 'گران‌ترین'],
  ['cheap', 'ارزان‌ترین'],
];
const FILTER_KEYS = ['priceFrom', 'priceTo', 'changed', 'mine'];

export async function loadCarPrices() {
  if (!cache || Date.now() - cache.at > TTL_MS) {
    cache = { at: Date.now(), data: await carPrices.list() };
  }
  return { prices: cache.data };
}

/** Forgotten after a star: the next open must not show a list five minutes old. */
export function forgetCarPrices() {
  cache = null;
}

// ── text ─────────────────────────────────────────────────────────────────────

/** The same folding the catalogue search uses: ی/ک, digits, ZWNJ, case. */
function norm(text) {
  return String(text || '')
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[۰-۹٠-٩]/g, (d) => enDigits(d))
    .replace(/[‌‌]/g, ' ')
    .toLowerCase()
    .replace(/[()،,\-/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** «۳٫۳۳۰ میلیارد» / «۸۲۶ میلیون» — for a row that is read, not copied. */
function compact(value) {
  if (value === null || value === undefined) return '—';
  if (value >= 1e9) return `${faDigits((value / 1e9).toFixed(3).replace(/\.?0+$/, ''))} میلیارد`;
  return `${faDigits(Math.round(value / 1e6))} میلیون`;
}

/**
 * To the nearest million toman, for the eye only.
 *
 * The source prints «۱,۱۵۹,۶۵۰,۹۹۹» and a dealer reads «یک میلیارد و صد و
 * شصت». The stored value stays exactly what the source said — this is a
 * display choice, not a data one — and the exact figure is on the tooltip.
 */
function rounded(value) {
  if (value === null || value === undefined) return null;
  return Math.round(value / 1e6) * 1e6;
}

/** The Persian half of «ولوو - Volvo». */
const brandFa = (brand) => String(brand || '').split(' - ')[0].trim();

// ── grouping rows into models ────────────────────────────────────────────────

// Engine and gearbox codes: a second word that names the motor, not the car.
const ENGINE = new Set(['tu3', 'tu5', 'tu5p', 'xu7', 'xu7p', 'ef7', 'ef7p', 'mt6', 'at', 'mt', 'cvt']);
// A first word that is a shape, not a model: «وانت آریسان» is an آریسان.
const GENERIC = new Set(['وانت', 'پیکاپ', 'ون']);

/**
 * Which model a row belongs to, from its name alone.
 *
 * The first word — or the first two when the second is a number or a short
 * code («پژو 207», «هایما S7», «ام وی ام X22»), because there the first word
 * is a brand. Parentheses are a trim («رینگ فولادی») and never part of it.
 */
function familyKey(name) {
  const tokens = norm(name.replace(/\([^)]*\)/g, ' ')).split(' ').filter(Boolean);
  if (!tokens.length) return norm(name);
  const from = GENERIC.has(tokens[0]) && tokens.length > 1 ? 1 : 0;
  const first = tokens[from];
  const second = tokens[from + 1];
  const code = second && !ENGINE.has(second) && (/^\d{2,4}$/.test(second) || /^[a-z]{1,2}\d{1,3}$|^\d[a-z]$/.test(second));
  return code ? `${first} ${second}` : first;
}

/** The words every name in a group starts with — the group's own name. */
function commonPrefix(names) {
  const lists = names.map((n) => n.replace(/\([^)]*\)/g, ' ').trim().split(/\s+/));
  const out = [];
  for (let i = 0; ; i += 1) {
    const word = lists[0][i];
    if (!word || !lists.every((l) => norm(l[i] || '') === norm(word))) break;
    out.push(word);
  }
  return out.join(' ');
}

function groupModels(items) {
  const map = new Map();
  for (const item of items) {
    const key = familyKey(item.name);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return [...map.values()].map((rows) => {
    const label = rows.length > 1 ? commonPrefix(rows.map((r) => r.name)) || rows[0].name : rows[0].name;
    const prices = rows.map((r) => r.price).filter((p) => p !== null);
    // The trim that moved the most today speaks for the model on its line.
    const moved = rows.filter((r) => r.change && r.direction !== 'FLAT');
    const top = moved.length ? moved.reduce((a, b) => ((b.changePct || 0) > (a.changePct || 0) ? b : a)) : null;
    return {
      label,
      rows,
      min: prices.length ? Math.min(...prices) : null,
      max: prices.length ? Math.max(...prices) : null,
      maxPct: top ? top.changePct || 0 : 0,
      top,
      order: Math.min(...rows.map((r) => r.sortOrder)),
    };
  });
}

// ── filters and sort ─────────────────────────────────────────────────────────

function applyFilters(items, params, watching) {
  const from = params.priceFrom ? Number(enDigits(params.priceFrom)) * 1e6 : null;
  const to = params.priceTo ? Number(enDigits(params.priceTo)) * 1e6 : null;
  return items.filter((it) => {
    if (from !== null && (it.price === null || it.price < from)) return false;
    if (to !== null && (it.price === null || it.price > to)) return false;
    if (params.changed && !(it.change && it.direction !== 'FLAT')) return false;
    if (params.mine && !watching.has(it.id)) return false;
    return true;
  });
}

function sortModels(models, sort) {
  const by = {
    change: (a, b) => b.maxPct - a.maxPct || a.order - b.order,
    expensive: (a, b) => (b.max ?? -1) - (a.max ?? -1) || a.order - b.order,
    cheap: (a, b) => (a.min ?? Infinity) - (b.min ?? Infinity) || a.order - b.order,
  }[sort];
  return by ? [...models].sort(by) : models;
}

function link(params, patch) {
  const next = { ...params, ...patch };
  for (const key of Object.keys(next)) if (!next[key]) delete next[key];
  return `#car-prices?${new URLSearchParams(next).toString()}`;
}

// ── pieces ───────────────────────────────────────────────────────────────────

/** «↑ ۹۴ میلیون (۵٫۲۱٪)» — with «تا» in front when it speaks for several trims. */
function changeCell(it, { upTo = false } = {}) {
  if (it.change === null || it.change === undefined) return html`<span class="pr-chg flat">—</span>`;
  if (!it.change || it.direction === 'FLAT') return html`<span class="pr-chg flat">بدون تغییر</span>`;
  const tone = it.direction === 'DOWN' ? 'down' : it.direction === 'UP' ? 'up' : 'flat';
  const arrow = tone === 'down' ? 'M12 5v14M5 12l7 7 7-7' : 'M12 19V5M5 12l7-7 7 7';
  return html`<span class="pr-chg ${tone}">
    ${upTo ? html`<small>تا</small>` : ''}
    ${raw(`<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${arrow}"></path></svg>`)}
    <span class="num">${compact(it.change)}</span>
    ${it.changePct !== null ? html`<small class="num">(${faDigits(it.changePct)}٪)</small>` : ''}
  </span>`;
}

function star(it, watching) {
  const on = watching.has(it.id);
  return html`<button type="button" class="pr-star ${on ? 'on' : ''}" data-price-watch="${it.id}"
    title="${on ? 'برداشتن از فهرست من' : 'افزودن به فهرست من'}" aria-pressed="${on ? 'true' : 'false'}">
    ${raw(`<svg width="16" height="16" viewBox="0 0 24 24" fill="${on ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.4 6.3 20.5l1.2-6.4L2.8 9.7l6.4-.8z"></path></svg>`)}
  </button>`;
}

/** One car: the full numbers, the change, the star. */
function row(it, watching, { name = it.name, sub = '', second = 'قیمت دوم' } = {}) {
  return html`<div class="pr-row" data-q="${norm(it.name)}">
    <div class="pr-nm"><b>${name}</b>${sub ? html`<small>${sub}</small>` : ''}</div>
    <div class="pr-c"><span class="pr-k">قیمت بازار</span><span class="pr-price num" title="دقیق: ${it.priceText}">${it.price === null ? it.priceText || '—' : num(rounded(it.price))}</span></div>
    <div class="pr-c"><span class="pr-k">${second}</span><span class="pr-second num" title="دقیق: ${it.secondText}">${it.second === null ? it.secondText || '—' : num(rounded(it.second))}</span></div>
    <div class="pr-c"><span class="pr-k">تغییر</span>${changeCell(it)}</div>
    <div class="pr-act">${star(it, watching)}</div>
  </div>`;
}

/** A model with several trims: one line, opens to its rows. */
function modelBox(model, watching, second) {
  const range =
    model.min === null
      ? '—'
      : model.min === model.max
        ? compact(model.min)
        : html`<small>از</small> ${compact(model.min)} <small>تا</small> ${compact(model.max)}`;
  // Each row is named by what is left after the model's name: «دنا پلاس
  // MT6 (رینگ فولادی)» under «دنا پلاس» is «MT6 (رینگ فولادی)»; the row
  // that is the bare model is «پایه»; a lone parenthesis loses its brackets.
  const trims = model.rows.map((r) => {
    const rest = norm(r.name).startsWith(norm(model.label)) ? r.name.slice(model.label.length).trim() : r.name;
    const trim = rest.replace(/^\(([^)]*)\)$/, '$1').trim();
    return row(r, watching, { name: trim || 'پایه', second });
  });
  return html`<details class="pr-model" data-q="${model.rows.map((r) => norm(r.name)).join(' | ')}">
    <summary>
      <span class="pr-nm"><b>${model.label}</b><small>${faDigits(model.rows.length)} تیپ</small></span>
      <span class="pr-range num">${range}</span>
      ${model.top ? changeCell(model.top, { upTo: true }) : html`<span class="pr-chg flat">بدون تغییر</span>`}
      <span class="pr-chev">${icon('chevron', 16)}</span>
    </summary>
    <div class="pr-trims">${trims}</div>
  </details>`;
}

/** «فهرست من»: nothing at all while it is empty. */
export function mineCard(prices) {
  const watching = new Set(prices.watching || []);
  if (!watching.size) return html``;
  const all = Object.entries(prices.groups).flatMap(([group, g]) =>
    g.items.filter((it) => watching.has(it.id)).map((it) => ({ ...it, secondLabel: shortLabel(g.secondLabel), group }))
  );
  if (!all.length) return html``;
  return html`<div class="card pr-mine" data-price-mine>
    <div class="card-h">
      <h2>فهرست من ${qtip('خودروهایی که ستاره زده‌اید. برای همه‌ی حساب‌های نمایندگی شما یکی است و همیشه بالای این صفحه می‌ماند.')}</h2>
      <span class="tag n">${faDigits(all.length)} خودرو</span>
    </div>
    <div class="pr-list">
      ${all.map((it) => row(it, watching, { sub: `${brandFa(it.brand)} · ${GROUP_FA[it.group]}`, second: it.secondLabel }))}
    </div>
  </div>`;
}

/** «قیمت کارخانه (تومان)» → «قیمت کارخانه». */
const shortLabel = (label) => (label || 'قیمت دوم').replace(/\(تومان\)/, '').trim();

function stampTag(prices) {
  if (!prices.updatedAt) return html`<span class="tag o">${icon('clock', 13)} هنوز به‌روزرسانی نشده</span>`;
  if (prices.stale) return html`<span class="tag o">${icon('clock', 13)} به‌روزرسانی با تأخیر — ${dateTime(prices.updatedAt)}</span>`;
  return html`<span class="tag g">${icon('clock', 13)} آخرین به‌روزرسانی: ${dateTime(prices.updatedAt)}</span>`;
}

// ── the page ─────────────────────────────────────────────────────────────────

export function carPricesPage() {
  const { data, params } = getState();
  const prices = data.prices;
  if (!prices) return emptyBox('فهرست قیمت در دسترس نیست.');

  const group = prices.groups[params.group] ? params.group : 'DOMESTIC';
  const current = prices.groups[group];
  const watching = new Set(prices.watching || []);
  const sort = SORTS.some(([k]) => k === params.sort) ? params.sort : 'src';

  const total = Object.values(prices.groups).reduce((n, g) => n + g.items.length, 0);
  if (!total) {
    return html`<div class="card">
      <div class="card-h"><h2>قیمت روز خودروها</h2>${stampTag(prices)}</div>
      ${emptyBox('فهرست قیمت هنوز دریافت نشده است — اولین به‌روزرسانی خودکار تا یک ساعت دیگر انجام می‌شود.')}
    </div>`;
  }

  // Brands of this group, in the source's order, with what each has left
  // after the filters — the chip says how many, and a brand with nothing
  // left is still a chip, so the reader can see it was the filter's doing.
  const filtered = applyFilters(current.items, params, watching);
  const brands = [];
  for (const it of current.items) if (!brands.includes(it.brand)) brands.push(it.brand);
  const brand = brands.includes(params.brand) ? params.brand : '';
  const secondLabel = shortLabel(current.secondLabel);

  const sections = brands.map((b) => {
    const rows = filtered.filter((it) => it.brand === b);
    const models = sortModels(groupModels(rows), sort);
    return html`<section class="pr-brand" data-brand="${b}" ${raw(brand && brand !== b ? 'hidden' : '')}>
      <div class="pr-bh"><b>${brandFa(b)}</b><small class="num">${faDigits(rows.length)} خودرو</small></div>
      ${models.length
        ? models.map((m) => (m.rows.length > 1 ? modelBox(m, watching, secondLabel) : row(m.rows[0], watching, { second: secondLabel })))
        : html`<p class="pr-none">با این فیلترها چیزی از ${brandFa(b)} نمانده.</p>`}
    </section>`;
  });

  return html`<div data-price-page>
    ${mineCard(prices)}

    <div class="card">
      <div class="card-h">
        <h2>قیمت روز خودروها ${qtip('قیمت بازار خودروهای صفر کیلومتر، هر ساعت به‌طور خودکار به‌روز می‌شود. ستاره‌ی کنار هر خودرو آن را به «فهرست من» می‌برد تا همیشه بالای این صفحه باشد.')}</h2>
        ${stampTag(prices)}
      </div>

      <div class="pr-bar">
        <div class="tabs">
          ${Object.keys(prices.groups).map(
            (g) => html`<a class="tab ${g === group ? 'on' : ''}" href="${link(params, { group: g, brand: '' })}">${GROUP_FA[g]}</a>`
          )}
        </div>
        <label class="pr-search">
          ${icon('search', 15)}
          <input type="search" data-price-search placeholder="جستجوی نام خودرو در همه‌ی برندها…" autocomplete="off">
        </label>
      </div>

      <div class="pr-chips">
        <a class="bchip ${brand ? '' : 'on'}" href="${link(params, { brand: '' })}">همه <small class="num">${faDigits(current.items.length)}</small></a>
        ${brands.map(
          (b) => html`<a class="bchip ${b === brand ? 'on' : ''}" href="${link(params, { brand: b })}">${brandFa(b)} <small class="num">${faDigits(current.items.filter((it) => it.brand === b).length)}</small></a>`
        )}
      </div>

      ${filterBox(countFilters(params, FILTER_KEYS), html`
      <form class="filters" data-form="price-filters">
        <div class="field">
          <label for="priceFrom">قیمت بازار از (میلیون تومان)</label>
          <input class="in num" id="priceFrom" name="priceFrom" inputmode="numeric" placeholder="۱٬۰۰۰" value="${params.priceFrom || ''}">
        </div>
        <div class="field">
          <label for="priceTo">تا (میلیون تومان)</label>
          <input class="in num" id="priceTo" name="priceTo" inputmode="numeric" placeholder="۳٬۰۰۰" value="${params.priceTo || ''}">
        </div>
        <div class="field">
          <label>&nbsp;</label>
          <label class="fchip ${params.changed ? 'on' : ''}"><input type="checkbox" name="changed" ${raw(params.changed ? 'checked' : '')}><span>فقط تغییرکرده‌های امروز</span></label>
        </div>
        <div class="field">
          <label>&nbsp;</label>
          <label class="fchip ${params.mine ? 'on' : ''}"><input type="checkbox" name="mine" ${raw(params.mine ? 'checked' : '')}><span>فقط فهرست من</span></label>
        </div>
        <div class="field" style="align-self:end">
          <button class="btn primary" type="submit">اعمال فیلتر</button>
          ${countFilters(params, FILTER_KEYS) ? html`<a class="btn ghost" href="${link(params, { priceFrom: '', priceTo: '', changed: '', mine: '' })}">حذف فیلترها</a>` : ''}
        </div>
      </form>`)}

      <div class="pr-sort">
        <span>مرتب‌سازی:</span>
        ${SORTS.map(([k, fa]) => html`<a class="sort ${k === sort ? 'on' : ''}" href="${link(params, { sort: k === 'src' ? '' : k })}">${fa}</a>`)}
        <span class="pr-cols"><span>قیمت بازار</span><span>${secondLabel}</span><span>تغییر</span></span>
      </div>

      <div class="pr-list" data-price-list>
        ${sections}
        <p class="pr-none" data-price-nomatch hidden>چیزی با این نام پیدا نشد.</p>
      </div>

      <div class="pr-foot">قیمت‌ها برای خودروی صفر کیلومتر، آخرین مدل و ارزان‌ترین رنگ بازار است و به میلیون تومان گرد شده‌اند؛ عدد دقیق با نگه‌داشتن نشانگر روی هر قیمت دیده می‌شود.</div>
    </div>
  </div>`;
}

// ── handlers (DOM only — nothing here re-renders the page) ───────────────────

/** The filter form → the address bar; the page re-renders from memory. */
export function applyPriceFilters(form) {
  const { params } = getState();
  const next = { group: params.group, brand: params.brand, sort: params.sort };
  for (const name of ['priceFrom', 'priceTo']) {
    const value = enDigits(form.elements[name]?.value || '').replace(/[^\d]/g, '');
    if (value) next[name] = value;
  }
  if (form.elements.changed?.checked) next.changed = '1';
  if (form.elements.mine?.checked) next.mine = '1';
  for (const key of Object.keys(next)) if (!next[key]) delete next[key];
  go('car-prices', next);
}

/**
 * Typing in the search box. Hides in place, across every brand; a query
 * overrides the brand chip (all sections come back while it is typed) and
 * opens every model that matched, so the trim that matched is visible.
 */
export function handlePriceSearch(input) {
  if (!input.matches?.('[data-price-search]')) return false;
  const q = norm(input.value);
  const list = document.querySelector('[data-price-list]');
  if (!list) return true;
  const { params } = getState();
  let shown = 0;

  list.querySelectorAll('.pr-brand').forEach((section) => {
    let visible = 0;
    section.querySelectorAll('.pr-model, :scope > .pr-row').forEach((node) => {
      const hit = !q || (node.dataset.q || '').includes(q);
      node.hidden = !hit;
      if (hit) visible += 1;
      if (node.matches('.pr-model')) {
        if (q && hit) node.open = true;
        else if (!q) node.open = false;
      }
    });
    // With a query, every brand is searched; without one, the chip rules.
    section.hidden = q ? visible === 0 : Boolean(params.brand && params.brand !== section.dataset.brand);
    if (!section.hidden) shown += visible;
  });
  const none = list.querySelector('[data-price-nomatch]');
  if (none) none.hidden = !(q && shown === 0);
  return true;
}

/** A star: add to or drop from «فهرست من», and patch the page in place. */
export async function togglePriceWatch(el) {
  const id = el.dataset.priceWatch;
  const on = el.classList.contains('on');
  try {
    const { watching } = on ? await carPrices.unwatch(id) : await carPrices.watch(id);
    if (cache) cache.data.watching = watching;
    const set = new Set(watching);

    document.querySelectorAll(`[data-price-watch="${CSS.escape(id)}"]`).forEach((button) => {
      const now = set.has(id);
      button.classList.toggle('on', now);
      button.setAttribute('aria-pressed', now ? 'true' : 'false');
      button.title = now ? 'برداشتن از فهرست من' : 'افزودن به فهرست من';
      button.querySelector('svg')?.setAttribute('fill', now ? 'currentColor' : 'none');
    });

    // The starred card is rebuilt on its own; the list — and whatever is
    // typed in the search box — stays exactly as it is.
    const page = document.querySelector('[data-price-page]');
    const fresh = cache ? String(mineCard(cache.data)) : '';
    const mine = page?.querySelector('[data-price-mine]');
    if (mine) mine.outerHTML = fresh;
    else if (page) page.insertAdjacentHTML('afterbegin', fresh);
    toast(on ? 'از فهرست من برداشته شد' : 'به فهرست من اضافه شد');
  } catch (err) {
    toast(err.message || 'انجام نشد', 'danger');
  }
}
