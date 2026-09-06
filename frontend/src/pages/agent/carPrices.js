import { html, raw } from '../../ui/html.js';
import { carPrices } from '../../api/index.js';
import { getState } from '../../state/store.js';
import { faDigits, enDigits, num, dateTime } from '../../ui/format.js';
import { toast, emptyBox, qtip } from '../../ui/feedback.js';
import { filterBox, countFilters } from '../../ui/filterBox.js';
import { moneyInput, moneyFieldId } from '../../ui/moneyInput.js';
import { icon } from '../../ui/icons.js';
import { go } from '../../router.js';

/**
 * The market price list — «قیمت روز خودروها».
 *
 * Read from our own snapshot, never from the source: the page is a database
 * read, and however many agencies open it at once, the source sees the same
 * two requests a quarter of an hour. The whole list (both groups, ~250 rows) comes in one
 * request and is kept for five minutes, so switching tab, brand or sort
 * re-renders from memory and costs nothing.
 *
 * The shape is a list beside a panel, because 115 rows read as a spreadsheet
 * when every fact is a column:
 *
 *   «فهرست من» — the cars this account starred, always on top, and simply not
 *   rendered while it is empty (the stars on the rows are the invitation).
 *
 *   the list — one row per MODEL with the price range across its trims, which
 *   open under it. «دنا پلاس» is three rows on the source and one here until
 *   it is opened. Only two numbers on a line: what it costs and what it did
 *   today.
 *
 *   the panel — everything else about the car you clicked: the exact figure,
 *   the factory price, how far the market has run from it, when it last
 *   moved. It is where the thirty-day trend will go once there are thirty
 *   days of it. On a phone it is a sheet that rises from the bottom.
 *
 * Search is live and client-side: rows carry a normalised copy of their name
 * and the handler hides what does not match, across every brand. Filters and
 * sort go through the address bar like every other list here, so a search can
 * be sent as a link — but picking a car does NOT, because a re-render would
 * empty the search box and shut every open model.
 *
 * Everything printed here came from somebody else's website. It goes through
 * the `html` tag like all other text, and nothing from it reaches a selector
 * without escaping.
 */

const TTL_MS = 5 * 60 * 1000;
let cache = null;

const GROUP_FA = { DOMESTIC: 'تولید داخل', IMPORTED: 'وارداتی' };
const SORTS = [
  ['src', 'پیش‌فرض'],
  ['change', 'بیشترین تغییر'],
  ['expensive', 'گران‌ترین'],
  ['cheap', 'ارزان‌ترین'],
];
const FILTER_KEYS = ['brands', 'priceFrom', 'priceTo', 'changed', 'mine'];

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

// ── text and numbers ─────────────────────────────────────────────────────────

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

/**
 * To the nearest million toman, for the eye only.
 *
 * «۱,۱۵۹,۶۵۰,۹۹۹» is read as «یک میلیارد و صد و شصت»; the trailing digits are
 * noise a dealer has to look past. The stored value is untouched — this is a
 * display choice, not a data one.
 */
function rounded(value) {
  if (value === null || value === undefined) return null;
  return Math.round(value / 1e6) * 1e6;
}

/** «۳٫۳۳ میلیارد» / «۸۲۶ میلیون» — for a range, which is read not compared. */
function compact(value) {
  if (value === null || value === undefined) return '—';
  if (value >= 1e9) return `${faDigits((value / 1e9).toFixed(2).replace(/\.?0+$/, ''))} میلیارد`;
  return `${faDigits(Math.round(value / 1e6))} میلیون`;
}

/**
 * «از ۱٫۶۵ تا ۱٫۶۷ میلیارد» — the unit said once.
 *
 * Repeating it («از ۱٫۶۵ میلیارد تا ۱٫۶۷ میلیارد») wrapped the line in two on
 * a desktop column, which made every multi-trim model twice as tall as the
 * single ones and the list lost its rhythm.
 */
function priceRange(min, max) {
  if (min === null) return '—';
  if (min === max) return compact(min);
  const unit = min >= 1e9 && max >= 1e9 ? 'میلیارد' : null;
  const n = (v) => (unit ? faDigits((v / 1e9).toFixed(2).replace(/\.?0+$/, '')) : compact(v));
  return { from: n(min), to: n(max), unit };
}

/** The Persian half of «ولوو - Volvo». */
const brandFa = (brand) => String(brand || '').split(' - ')[0].trim();

/** «قیمت کارخانه (تومان)» → «قیمت کارخانه». */
const shortLabel = (label) => (label || 'قیمت دوم').replace(/\(تومان\)/, '').trim();

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
      top,
      order: Math.min(...rows.map((r) => r.sortOrder)),
    };
  });
}

// ── filters and sort ─────────────────────────────────────────────────────────

function applyFilters(items, params, watching) {
  const from = params.priceFrom ? Number(enDigits(params.priceFrom)) : null;
  const to = params.priceTo ? Number(enDigits(params.priceTo)) : null;
  return items.filter((it) => {
    if (from !== null && (it.price === null || it.price < from)) return false;
    if (to !== null && (it.price === null || it.price > to)) return false;
    if (params.changed && !(it.change && it.direction !== 'FLAT')) return false;
    if (params.mine && !watching.has(it.id)) return false;
    return true;
  });
}

function sortModels(models, sort) {
  const pct = (m) => (m.top ? m.top.changePct || 0 : 0);
  const by = {
    change: (a, b) => pct(b) - pct(a) || a.order - b.order,
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
  const tone = it.direction === 'DOWN' ? 'down' : 'up';
  const arrow = tone === 'down' ? 'M12 5v14M5 12l7 7 7-7' : 'M12 19V5M5 12l7-7 7 7';
  return html`<span class="pr-chg ${tone}">
    ${upTo ? html`<small>تا</small>` : ''}
    ${raw(`<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${arrow}"></path></svg>`)}
    <span class="num">${compact(it.change)}</span>
    ${it.changePct !== null ? html`<small class="num">(${faDigits(it.changePct)}٪)</small>` : ''}
  </span>`;
}

function star(it, watching, { big = false } = {}) {
  const on = watching.has(it.id);
  const glyph = raw(`<svg width="${big ? 15 : 16}" height="${big ? 15 : 16}" viewBox="0 0 24 24" fill="${on ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.4 6.3 20.5l1.2-6.4L2.8 9.7l6.4-.8z"></path></svg>`);
  if (big) {
    return html`<button type="button" class="btn ${on ? 'starred' : ''}" data-price-watch="${it.id}">
      ${glyph}${on ? 'در فهرست من' : 'افزودن به فهرست من'}
    </button>`;
  }
  return html`<button type="button" class="pr-star ${on ? 'on' : ''}" data-price-watch="${it.id}"
    title="${on ? 'برداشتن از فهرست من' : 'افزودن به فهرست من'}" aria-pressed="${on ? 'true' : 'false'}">
    ${glyph}
  </button>`;
}

/**
 * One car on a line: what it costs and what it did today. Everything else is
 * one click away in the panel, which is what keeps this from being a table.
 */
function row(it, watching, { name = it.name, sub = '' } = {}) {
  return html`<div class="pr-row" data-q="${norm(it.name)}" data-price-pick="${it.id}" role="button" tabindex="0">
    <span class="pr-nm"><b>${name}</b>${sub ? html`<small>${sub}</small>` : ''}</span>
    <span class="pr-price num">${it.price === null ? it.priceText || '—' : num(rounded(it.price))}</span>
    ${changeCell(it)}
    <span class="pr-act">${star(it, watching)}</span>
  </div>`;
}

/** A model with several trims: one line, opens to its rows. */
function modelBox(model, watching) {
  const r = priceRange(model.min, model.max);
  const range =
    typeof r === 'string'
      ? r
      : html`<small>از</small> ${r.from} <small>تا</small> ${r.to}${r.unit ? ` ${r.unit}` : ''}`;
  // Each row is named by what is left after the model's name: «دنا پلاس MT6
  // (رینگ فولادی)» under «دنا پلاس» is «MT6 (رینگ فولادی)»; the row that is
  // the bare model is «پایه»; a lone parenthesis loses its brackets.
  const trims = model.rows.map((r) => {
    const rest = norm(r.name).startsWith(norm(model.label)) ? r.name.slice(model.label.length).trim() : r.name;
    const trim = rest.replace(/^\(([^)]*)\)$/, '$1').trim();
    return row(r, watching, { name: trim || 'پایه' });
  });
  return html`<details class="pr-model" data-q="${model.rows.map((r) => norm(r.name)).join(' | ')}">
    <summary>
      <span class="pr-nm"><b>${model.label}</b><small>${faDigits(model.rows.length)} تیپ</small></span>
      <span class="pr-range num">${range}</span>
      ${model.top ? changeCell(model.top, { upTo: true }) : html`<span class="pr-chg flat">بدون تغییر</span>`}
      <span class="pr-chev">${icon('chevron', 16)}</span>
    </summary>
    <div class="pr-trims"><span class="pr-tlbl">تیپ‌ها</span>${trims}</div>
  </details>`;
}

/**
 * The panel: one car, spelled out.
 *
 * The exact figure is here rather than in the list because the list is read
 * down a column and the panel is read once. «فاصله از کارخانه» is the number
 * a dealer actually talks about and neither of the two prices states it.
 */
function detailPanel(it, watching, secondLabel) {
  if (!it) {
    return html`<div class="pr-empty">
      ${icon('tag', 22)}
      <p>روی هر خودرو بزنید تا جزئیات قیمتش این‌جا بیاید.</p>
    </div>`;
  }
  const gap = it.price !== null && it.second !== null && it.second > 0 ? it.price - it.second : null;
  const gapPct = gap === null ? null : Math.round((gap / it.second) * 100);
  return html`<div class="pr-d">
    <div class="pr-dh">
      <div>
        <h3>${it.name}</h3>
        <div class="pr-dsub">${brandFa(it.brand)} · ${GROUP_FA[it.group] || ''}</div>
      </div>
      <button type="button" class="pr-dx" data-price-close aria-label="بستن">${icon('close', 16)}</button>
    </div>

    <div class="pr-big">
      <span class="pr-k">قیمت بازار</span>
      <b class="num">${it.price === null ? it.priceText || '—' : num(rounded(it.price))}</b>
      ${it.price === null ? '' : html`<small>تومان</small>`}
    </div>

    <dl class="pr-facts">
      <div><dt>${secondLabel}</dt><dd class="num">${it.second === null ? it.secondText || '—' : num(rounded(it.second))}</dd></div>
      ${gap === null
        ? ''
        : html`<div><dt>فاصله‌ی بازار از ${secondLabel.replace('قیمت ', '')}</dt>
            <dd class="num ${gap > 0 ? 'up' : 'down'}">${gap > 0 ? '+' : '−'}${compact(Math.abs(gap))} (${faDigits(Math.abs(gapPct))}٪)</dd></div>`}
      <div><dt>تغییر امروز</dt><dd>${changeCell(it)}</dd></div>
    </dl>

    <div class="pr-dact">${star(it, watching, { big: true })}</div>
  </div>`;
}

/** «فهرست من»: nothing at all while it is empty. */
export function mineCard(prices) {
  const watching = new Set(prices.watching || []);
  if (!watching.size) return html``;
  const all = Object.entries(prices.groups).flatMap(([group, g]) =>
    g.items.filter((it) => watching.has(it.id)).map((it) => ({ ...it, group }))
  );
  if (!all.length) return html``;
  return html`<div class="card pr-mine" data-price-mine>
    <div class="card-h">
      <h2>فهرست من ${qtip('خودروهایی که خودتان ستاره زده‌اید. فقط برای همین حساب است و کاربران دیگرِ نمایندگی آن را نمی‌بینند.')}</h2>
      <span class="tag n">${faDigits(all.length)} خودرو</span>
    </div>
    <div class="pr-list"><div class="pr-items">
      ${all.map((it) => row(it, watching, { sub: `${brandFa(it.brand)} · ${GROUP_FA[it.group]}` }))}
    </div></div>
  </div>`;
}

/**
 * The date the list itself carries — «چهارشنبه، ۱۵ شهریور ۱۴۰۵ ، ۱۳:۳۲:۴۴»
 * without the weekday and the seconds. Anything that does not look like that
 * is printed as it came, which is still better than a wrong guess.
 */
function pricedAtFa(stamp) {
  // The digits arrive Persian, and `\d` does not match those — the first
  // version quietly matched nothing and fell back to our own clock, which is
  // the exact confusion this is here to remove.
  const latin = enDigits(String(stamp || ''));
  const m = latin.match(/(\d{1,2}\s+\S+\s+\d{4})\s*[،,]?\s*(\d{1,2}:\d{2})/);
  if (m) return faDigits(`${m[1]} ساعت ${m[2]}`);
  return String(stamp || '').replace(/^[^،]*،\s*/, '').trim();
}

/**
 * When the prices are from.
 *
 * The list states its own date, and that is what «قیمت روز» means to a
 * dealer; the minute our job happened to run is a fact about us. So the badge
 * shows the list's date — and «با تأخیر» still comes from our own last
 * successful run, so a fetch that quietly stopped is still visible.
 */
function stampTag(prices, group) {
  const when = pricedAtFa(prices.groups[group]?.pricedAt) || (prices.updatedAt ? dateTime(prices.updatedAt) : '');
  if (!when) return html`<span class="tag o">${icon('clock', 13)} هنوز به‌روزرسانی نشده</span>`;
  if (prices.stale) return html`<span class="tag o">${icon('clock', 13)} به‌روزرسانی با تأخیر — ${when}</span>`;
  return html`<span class="tag g">${icon('clock', 13)} آخرین به‌روزرسانی: ${when}</span>`;
}

/**
 * The companies, as tick boxes inside the filter panel.
 *
 * Twenty-one of them in a row across the top of the page was a wall of chips
 * before a single price. And the count has to say its own unit: «بی‌ام‌و ۷»
 * is a car — the 7 Series — not seven cars.
 *
 * The markup matches ui/checkChips so the shared change handler drives it;
 * only the label is richer than that component can express.
 */
function brandChips(items, selected) {
  const on = new Set(String(selected || '').split(',').filter(Boolean));
  const counts = new Map();
  for (const it of items) {
    const key = brandFa(it.brand);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return html`<div class="fchips pr-brands" data-chipbox>
    <input type="hidden" name="brands" value="${[...on].join(',')}">
    ${[...counts].map(
      ([name, n]) => html`<label class="fchip ${on.has(name) ? 'on' : ''}">
        <input type="checkbox" data-chip="${name}" ${raw(on.has(name) ? 'checked' : '')}>
        <span>${name}</span><small class="num">${faDigits(n)} خودرو</small>
      </label>`
    )}
  </div>`;
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
  const secondLabel = shortLabel(current.secondLabel);

  const total = Object.values(prices.groups).reduce((n, g) => n + g.items.length, 0);
  if (!total) {
    return html`<div class="card">
      <div class="card-h"><h2>قیمت روز خودروها</h2>${stampTag(prices, 'DOMESTIC')}</div>
      ${emptyBox('فهرست قیمت هنوز دریافت نشده است — اولین به‌روزرسانی خودکار تا چند دقیقه‌ی دیگر انجام می‌شود.')}
    </div>`;
  }

  const picked = new Set(String(params.brands || '').split(',').filter(Boolean));
  const filtered = applyFilters(current.items, params, watching);
  const brands = [];
  for (const it of current.items) if (!brands.includes(it.brand)) brands.push(it.brand);
  const shown = brands.filter((b) => !picked.size || picked.has(brandFa(b)));

  const sections = shown.map((b) => {
    const rows = filtered.filter((it) => it.brand === b);
    const models = sortModels(groupModels(rows), sort);
    return html`<section class="pr-brand" data-brand="${brandFa(b)}">
      <div class="pr-bh"><b>${brandFa(b)}</b><small class="num">${faDigits(rows.length)} خودرو</small></div>
      <div class="pr-items">
        ${models.length
          ? models.map((m) => (m.rows.length > 1 ? modelBox(m, watching) : row(m.rows[0], watching)))
          : html`<p class="pr-none">با این فیلترها چیزی از ${brandFa(b)} نمانده.</p>`}
      </div>
    </section>`;
  });

  const filters = countFilters(params, FILTER_KEYS);

  return html`<div data-price-page>
    ${mineCard(prices)}

    <div class="pr-wrap">
      <div class="card">
        <div class="card-h">
          <h2>قیمت روز خودروها ${qtip('قیمت بازار خودروهای صفر کیلومتر، هر ۱۵ دقیقه به‌طور خودکار به‌روز می‌شود. روی هر خودرو بزنید تا جزئیاتش را ببینید، و ستاره را بزنید تا به «فهرست من» برود.')}</h2>
          ${stampTag(prices, group)}
        </div>

        <div class="pr-bar">
          <div class="tabs">
            ${Object.keys(prices.groups).map(
              (g) => html`<a class="tab ${g === group ? 'on' : ''}" href="${link(params, { group: g, brands: '' })}">${GROUP_FA[g]}</a>`
            )}
          </div>
          <label class="pr-search">
            ${icon('search', 15)}
            <input type="search" data-price-search placeholder="جستجوی نام خودرو در همه‌ی برندها…" autocomplete="off">
          </label>
        </div>

        ${filterBox(filters, html`
        <form class="filters" data-form="price-filters">
          <div class="field wide">
            <label>شرکت</label>
            ${brandChips(current.items, params.brands)}
          </div>
          <div class="field">
            <label for="${moneyFieldId('priceFrom')}">قیمت بازار از (تومان)</label>
            ${moneyInput('priceFrom', { value: params.priceFrom || '' })}
          </div>
          <div class="field">
            <label for="${moneyFieldId('priceTo')}">تا (تومان)</label>
            ${moneyInput('priceTo', { value: params.priceTo || '' })}
          </div>
          <div class="field wide">
            <div class="fchips">
              <label class="fchip ${params.changed ? 'on' : ''}"><input type="checkbox" name="changed" ${raw(params.changed ? 'checked' : '')}><span>فقط تغییرکرده‌های امروز</span></label>
              <label class="fchip ${params.mine ? 'on' : ''}"><input type="checkbox" name="mine" ${raw(params.mine ? 'checked' : '')}><span>فقط فهرست من</span></label>
            </div>
          </div>
          <div class="field wide btnrow">
            <button class="btn primary" type="submit">اعمال فیلتر</button>
            ${filters ? html`<a class="btn ghost" href="${link(params, { brands: '', priceFrom: '', priceTo: '', changed: '', mine: '' })}">حذف فیلترها</a>` : ''}
          </div>
        </form>`)}

        <div class="pr-sort">
          <span>مرتب‌سازی:</span>
          ${SORTS.map(([k, fa]) => html`<a class="sort ${k === sort ? 'on' : ''}" href="${link(params, { sort: k === 'src' ? '' : k })}">${fa}</a>`)}
        </div>

        <div class="pr-head"><span>خودرو</span><span>قیمت بازار (تومان)</span><span>تغییر امروز</span><span></span></div>

        <div class="pr-list" data-price-list>
          ${sections}
          <p class="pr-none" data-price-nomatch hidden>چیزی با این نام پیدا نشد.</p>
        </div>

        <div class="pr-foot">قیمت‌ها برای خودروی صفر کیلومتر، آخرین مدل و ارزان‌ترین رنگ بازار است و به میلیون گرد شده‌اند.</div>
      </div>

      <aside class="pr-panel" data-price-panel data-second="${secondLabel}">
        ${detailPanel(null)}
      </aside>
    </div>
  </div>`;
}

// ── handlers (DOM only — nothing here re-renders the page) ───────────────────

/** The filter form → the address bar; the page re-renders from memory. */
export function applyPriceFilters(form) {
  const { params } = getState();
  const next = { group: params.group, sort: params.sort };
  const brands = form.elements.brands?.value;
  if (brands) next.brands = brands;
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
 * overrides the brand filter (every section comes back while it is typed) and
 * opens every model that matched, so the trim that matched is visible.
 */
export function handlePriceSearch(input) {
  if (!input.matches?.('[data-price-search]')) return false;
  const q = norm(input.value);
  const list = document.querySelector('[data-price-list]');
  if (!list) return true;
  let shown = 0;

  list.querySelectorAll('.pr-brand').forEach((section) => {
    let visible = 0;
    section.querySelectorAll('.pr-model, .pr-items > .pr-row').forEach((node) => {
      const hit = !q || (node.dataset.q || '').includes(q);
      node.hidden = !hit;
      if (hit) visible += 1;
      if (node.matches('.pr-model')) {
        if (q && hit) node.open = true;
        else if (!q) node.open = false;
      }
    });
    section.hidden = q ? visible === 0 : false;
    if (!section.hidden) shown += visible;
  });
  const none = list.querySelector('[data-price-nomatch]');
  if (none) none.hidden = !(q && shown === 0);
  return true;
}

/** The car in the snapshot, whichever group it is in. */
function findItem(id) {
  if (!cache) return null;
  for (const [group, g] of Object.entries(cache.data.groups)) {
    const hit = g.items.find((it) => it.id === id);
    if (hit) return { ...hit, group, secondLabel: shortLabel(g.secondLabel) };
  }
  return null;
}

function paintPanel(it) {
  const panel = document.querySelector('[data-price-panel]');
  if (!panel) return;
  const watching = new Set(cache?.data.watching || []);
  panel.innerHTML = String(detailPanel(it, watching, it?.secondLabel || panel.dataset.second || 'قیمت دوم'));
  panel.classList.toggle('open', Boolean(it));
}

/**
 * Clicking a row fills the panel — no navigation, so the page keeps its
 * state. Below 1100px the panel is a sheet that rises over the list, so
 * nothing has to scroll for it to be seen.
 */
export function pickPrice(el) {
  const id = el.dataset.pricePick;
  const it = findItem(id);
  if (!it) return;
  document.querySelectorAll('.pr-row.on').forEach((node) => node.classList.remove('on'));
  el.classList.add('on');
  paintPanel(it);
}

export function closePriceDetail() {
  document.querySelectorAll('.pr-row.on').forEach((node) => node.classList.remove('on'));
  paintPanel(null);
}

/** A star: add to or drop from «فهرست من», and patch the page in place. */
export async function togglePriceWatch(el) {
  const id = el.dataset.priceWatch;
  const on = el.classList.contains('on') || el.classList.contains('starred');
  try {
    const { watching } = on ? await carPrices.unwatch(id) : await carPrices.watch(id);
    if (cache) cache.data.watching = watching;
    const set = new Set(watching);
    const now = set.has(id);

    document.querySelectorAll(`[data-price-watch="${CSS.escape(id)}"]`).forEach((button) => {
      button.classList.toggle('on', now && button.matches('.pr-star'));
      button.classList.toggle('starred', now && !button.matches('.pr-star'));
      if (button.matches('.pr-star')) {
        button.setAttribute('aria-pressed', now ? 'true' : 'false');
        button.title = now ? 'برداشتن از فهرست من' : 'افزودن به فهرست من';
      } else {
        button.lastChild.textContent = now ? 'در فهرست من' : 'افزودن به فهرست من';
      }
      button.querySelector('svg')?.setAttribute('fill', now ? 'currentColor' : 'none');
    });

    // The starred card is rebuilt on its own; the list — and whatever is
    // typed in the search box — stays exactly as it is.
    const page = document.querySelector('[data-price-page]');
    const fresh = cache ? String(mineCard(cache.data)) : '';
    const mine = page?.querySelector('[data-price-mine]');
    if (mine) mine.outerHTML = fresh;
    else if (page) page.insertAdjacentHTML('afterbegin', fresh);
    toast(now ? 'به فهرست من اضافه شد' : 'از فهرست من برداشته شد');
  } catch (err) {
    toast(err.message || 'انجام نشد', 'danger');
  }
}
