import { html, raw } from './html.js';
import { faDigits } from './format.js';

/**
 * The body of a car: the twenty-two-part table an agency fills in, and the
 * three-view cut-out a buyer reads it on.
 *
 * Two components share this file because they share one vocabulary and must
 * never drift: `bodyMatrix` is the form (chips, DOM-state, one hidden JSON
 * input), `bodyMapView` is the display (the cut-out images with a coloured
 * dot per marked part). The parts, the allowed conditions and the grade
 * ladder mirror `backend/src/modules/car/car.constants.js` — the server
 * re-validates and re-derives regardless; this copy exists so the form can
 * refuse and label things before a round-trip.
 *
 * The cut-outs come from the owner's own sheets in `assets/body/sheets/*.png`.
 * Each sheet carries several views; the two used here — the plan and the
 * profile — are cropped out with pixel-exact windows measured from the images
 * themselves, and `scripts/crop-body-sheets.py` turns those windows into the
 * small WebP files the page actually loads (`assets/body/<type>-plan.webp`,
 * `<type>-side.webp`). The first version cropped in CSS, by showing a 900 KB
 * sheet three times through a window; on a phone that was a long wait for
 * three empty boxes with dots on them. Thirty kilobytes per view is not.
 * Re-run the script if a sheet or a window is ever changed.
 *
 * Iranian cars are left-hand drive: the nose-left profile is the DRIVER
 * flank, the passenger flank is the same view mirrored, and in the plan view
 * the lower half is the driver side.
 */

export const PART_STATUS_FA = {
  PARTIAL: 'رنگ جزئی',
  PAINT: 'رنگ',
  SPRAY: 'پاشش رنگ',
  DAMAGE: 'آسیب جزئی',
  REPLACE: 'تعویض',
};

const PANEL = ['PARTIAL', 'PAINT', 'REPLACE', 'SPRAY'];
const CHASSIS = ['DAMAGE', 'PAINT', 'REPLACE', 'SPRAY'];
const RAIL = ['DAMAGE', 'PAINT', 'REPLACE'];
const SILL = ['PARTIAL', 'PAINT', 'REPLACE'];
const TRAY = ['PARTIAL', 'PAINT', 'REPLACE', 'SPRAY'];

export const BODY_PARTS = [
  { key: 'fnd-f-d', fa: 'گلگیر جلو راننده', allowed: PANEL },
  { key: 'fnd-f-p', fa: 'گلگیر جلو شاگرد', allowed: PANEL },
  { key: 'fnd-r-d', fa: 'گلگیر عقب راننده', allowed: PANEL },
  { key: 'fnd-r-p', fa: 'گلگیر عقب شاگرد', allowed: PANEL },
  { key: 'dr-f-d', fa: 'درب جلو راننده', allowed: PANEL },
  { key: 'dr-f-p', fa: 'درب جلو شاگرد', allowed: PANEL },
  { key: 'dr-r-d', fa: 'درب عقب راننده', allowed: PANEL },
  { key: 'dr-r-p', fa: 'درب عقب شاگرد', allowed: PANEL },
  { key: 'hood', fa: 'کاپوت', allowed: PANEL },
  { key: 'trunk', fa: 'صندوق', allowed: PANEL },
  { key: 'roof', fa: 'سقف', allowed: PANEL },
  { key: 'chs-f-d', fa: 'شاسی جلو راننده', allowed: CHASSIS, chassis: true },
  { key: 'chs-f-p', fa: 'شاسی جلو شاگرد', allowed: CHASSIS, chassis: true },
  { key: 'chs-r-d', fa: 'شاسی عقب راننده', allowed: CHASSIS, chassis: true },
  { key: 'chs-r-p', fa: 'شاسی عقب شاگرد', allowed: CHASSIS, chassis: true },
  { key: 'rl-f-d', fa: 'سرشاسی جلو راننده', allowed: RAIL, chassis: true },
  { key: 'rl-f-p', fa: 'سرشاسی جلو شاگرد', allowed: RAIL, chassis: true },
  { key: 'rl-r-d', fa: 'سرشاسی عقب راننده', allowed: RAIL, chassis: true },
  { key: 'rl-r-p', fa: 'سرشاسی عقب شاگرد', allowed: RAIL, chassis: true },
  { key: 'sill-f', fa: 'پالونی جلو', allowed: SILL },
  { key: 'sill-r', fa: 'پالونی عقب', allowed: SILL },
  { key: 'tray', fa: 'سینی و پالونی', allowed: TRAY },
];

const PART_BY_KEY = Object.fromEntries(BODY_PARTS.map((p) => [p.key, p]));

export const GRADE_FA = {
  NO_PAINT: 'بدون رنگ',
  MINOR_PAINT: 'رنگ جزئی',
  PAINTED: 'رنگ‌شده',
  REPLACED: 'تعویض‌دار',
  CHASSIS_DAMAGED: 'شاسی‌خورده',
};

/** good / warn / bad — which chip tone a grade wears on a card. */
export const GRADE_TONE = {
  NO_PAINT: 'g',
  MINOR_PAINT: 'w',
  PAINTED: 'w',
  REPLACED: 'r',
  CHASSIS_DAMAGED: 'r',
};

export const BODY_TYPE_FA = {
  SEDAN: 'سدان',
  HATCHBACK: 'هاچبک',
  SUV: 'شاسی‌بلند',
  PICKUP: 'وانت',
};

/** The client-side twin of the server's ladder, for live labels only. */
export function gradeOf(bodyStatus) {
  const entries = Object.entries(bodyStatus || {});
  if (!entries.length) return 'NO_PAINT';
  const chassisHit = entries.some(([key, st]) => PART_BY_KEY[key]?.chassis && st !== 'SPRAY');
  if (chassisHit) return 'CHASSIS_DAMAGED';
  const statuses = entries.map(([, st]) => st);
  if (statuses.includes('REPLACE')) return 'REPLACED';
  if (statuses.includes('PAINT')) return 'PAINTED';
  return 'MINOR_PAINT';
}

// ── the cut-out geometry ────────────────────────────────────────────────────

// planCrop / sideCrop are still the windows on the 1448×1086 sheet, in
// percent — the dot coordinates below are measured on the sheet, not on the
// crop, and the crop script reads the same numbers.

const SHEETS = {
  SEDAN: {
    file: 'sedan',
    planSize: [800, 369],
    sideSize: [800, 261],
    planCrop: [18.23, 31.12, 81.49, 70.07],
    sideCrop: [19.61, 71.45, 80.04, 97.7],
    plan: {
      hood: [29.5, 50], roof: [51, 50], trunk: [72, 50],
      'chs-f-d': [31, 59.5], 'chs-f-p': [31, 41], 'chs-r-d': [67, 58.5], 'chs-r-p': [67, 41.5],
      'rl-f-d': [24, 57.5], 'rl-f-p': [24, 42.5], 'rl-r-d': [75, 57.5], 'rl-r-p': [75, 42.5],
      'sill-f': [20.5, 50], 'sill-r': [79.5, 50], tray: [26.5, 50],
    },
    side: { 'fnd-f-d': [29.9, 83], 'dr-f-d': [43, 84.5], 'dr-r-d': [55.5, 84.5], 'fnd-r-d': [66.1, 83] },
  },
  HATCHBACK: {
    file: 'hatchback',
    planSize: [800, 402],
    sideSize: [800, 314],
    planCrop: [20.23, 29.83, 79.07, 69.24],
    sideCrop: [21.48, 69.8, 76.17, 98.43],
    plan: {
      hood: [31, 50], roof: [51, 50], trunk: [69, 50],
      'chs-f-d': [31, 59.5], 'chs-f-p': [31, 41], 'chs-r-d': [65, 58.5], 'chs-r-p': [65, 41.5],
      'rl-f-d': [24.5, 57.5], 'rl-f-p': [24.5, 42.5], 'rl-r-d': [72.5, 57.5], 'rl-r-p': [72.5, 42.5],
      'sill-f': [21.5, 50], 'sill-r': [77, 50], tray: [27, 50],
    },
    side: { 'fnd-f-d': [31.3, 81.5], 'dr-f-d': [44, 84.5], 'dr-r-d': [56, 84.5], 'fnd-r-d': [64.7, 81.5] },
  },
  SUV: {
    file: 'suv',
    planSize: [800, 354],
    sideSize: [800, 304],
    planCrop: [17.96, 30.2, 81.42, 67.68],
    sideCrop: [21.27, 69.24, 77.35, 97.7],
    plan: {
      hood: [30, 50], roof: [51, 50], trunk: [72, 50],
      'chs-f-d': [30, 59.5], 'chs-f-p': [30, 41], 'chs-r-d': [66, 58.5], 'chs-r-p': [66, 41.5],
      'rl-f-d': [23.5, 57.5], 'rl-f-p': [23.5, 42.5], 'rl-r-d': [75.5, 57.5], 'rl-r-p': [75.5, 42.5],
      'sill-f': [20, 50], 'sill-r': [80, 50], tray: [26, 50],
    },
    side: { 'fnd-f-d': [31.4, 81.5], 'dr-f-d': [43.5, 84.5], 'dr-r-d': [56, 84.5], 'fnd-r-d': [65.6, 81.5] },
  },
  PICKUP: {
    file: 'pickup',
    planSize: [800, 351],
    sideSize: [800, 285],
    planCrop: [19.82, 31.03, 79.14, 65.75],
    sideCrop: [17.4, 67.13, 82.04, 97.88],
    plan: {
      hood: [27.5, 47.5], roof: [48, 47.5], trunk: [69, 47.5],
      'chs-f-d': [28, 56], 'chs-f-p': [28, 39.5], 'chs-r-d': [63, 56], 'chs-r-p': [63, 39.5],
      'rl-f-d': [22.5, 54], 'rl-f-p': [22.5, 42], 'rl-r-d': [73, 54], 'rl-r-p': [73, 42],
      'sill-f': [20, 47.5], 'sill-r': [77, 47.5], tray: [24.5, 47.5],
    },
    side: { 'fnd-f-d': [27.7, 80.1], 'dr-f-d': [40.7, 80], 'dr-r-d': [53, 80], 'fnd-r-d': [66.5, 80.1] },
  },
};

/** Passenger side-view twins: the same point, mirrored on the flipped view. */
const DRIVER_TWIN = { 'fnd-f-p': 'fnd-f-d', 'fnd-r-p': 'fnd-r-d', 'dr-f-p': 'dr-f-d', 'dr-r-p': 'dr-r-d' };

/**
 * One view: a plain image with its intrinsic size on the tag, so the box has
 * the right height before a byte arrives and on browsers that never heard of
 * aspect-ratio; the dots sit on top in percent of the same box.
 */
function viewBox(sheet, view, { flip = false, label, dots }) {
  const [w, h] = view === 'plan' ? sheet.planSize : sheet.sideSize;
  return html`<div class="bm-view ${flip ? 'bm-flip' : ''}">
    <img src="/assets/body/${sheet.file}-${view}.webp" width="${w}" height="${h}" alt="" decoding="async">
    <span class="bm-tag">${label}</span>
    ${dots}
  </div>`;
}

function dotIn(crop, [x, y], status, title, mirror = false) {
  const [x0, y0, x1, y1] = crop;
  let lx = ((x - x0) / (x1 - x0)) * 100;
  if (mirror) lx = 100 - lx;
  const ty = ((y - y0) / (y1 - y0)) * 100;
  return html`<span class="bm-dot st-${status}" title="${title}"
    style="left:${lx.toFixed(2)}%;top:${ty.toFixed(2)}%"></span>`;
}

/**
 * The read-only map: three views of this body type with one dot per marked
 * part, a legend, and the marked parts spelled out — because a coloured dot
 * answers «where», and the sentence under it answers «what».
 */
export function bodyMapView(bodyType, bodyStatus = {}, { marked: showMarked = true } = {}) {
  const sheet = SHEETS[bodyType] || SHEETS.SEDAN;
  const marked = Object.entries(bodyStatus).filter(([key]) => PART_BY_KEY[key]);

  const planDots = [];
  const driverDots = [];
  const passengerDots = [];
  for (const [key, status] of marked) {
    const title = `${PART_BY_KEY[key].fa} — ${PART_STATUS_FA[status] || status}`;
    if (sheet.plan[key]) planDots.push(dotIn(sheet.planCrop, sheet.plan[key], status, title));
    else if (sheet.side[key]) driverDots.push(dotIn(sheet.sideCrop, sheet.side[key], status, title));
    else if (DRIVER_TWIN[key]) {
      passengerDots.push(dotIn(sheet.sideCrop, sheet.side[DRIVER_TWIN[key]], status, title, true));
    }
  }

  return html`<div class="bm-map">
    <div class="bm-views">
      ${viewBox(sheet, 'plan', { label: 'نمای بالا', dots: planDots })}
      ${viewBox(sheet, 'side', { label: 'سمت راننده', dots: driverDots })}
      ${viewBox(sheet, 'side', { flip: true, label: 'سمت شاگرد', dots: passengerDots })}
    </div>
    <div class="bm-legend">
      ${Object.entries(PART_STATUS_FA).map(
        ([key, fa]) => html`<b><span class="bm-sw st-${key}"></span>${fa}</b>`
      )}
    </div>
    ${
      !showMarked
        ? ''
        : marked.length
        ? html`<ul class="bm-marked">
            ${marked.map(
              ([key, status]) => html`<li>
                <span class="bm-sw st-${status}"></span>${PART_BY_KEY[key].fa}
                <span class="bm-st">${PART_STATUS_FA[status] || status}</span>
              </li>`
            )}
          </ul>`
        : html`<p class="bm-clean">قطعه‌ای علامت نخورده — بدون رنگ و تعویض.</p>
    `}
  </div>`;
}

// ── the form matrix ─────────────────────────────────────────────────────────

/**
 * The twenty-two parts, in the five groups a dealer already says out loud.
 *
 * Flat, the table is twenty-two names and eighty-odd chips — a two-thousand
 * pixel scroll on a phone that a seller marking one fender had to walk all
 * the way down. Grouped, the section is five lines until something is opened.
 */
const PART_GROUPS = [
  ['گلگیرها', ['fnd-f-d', 'fnd-f-p', 'fnd-r-d', 'fnd-r-p']],
  ['درب‌ها', ['dr-f-d', 'dr-f-p', 'dr-r-d', 'dr-r-p']],
  ['کاپوت، صندوق و سقف', ['hood', 'trunk', 'roof']],
  ['شاسی و سرشاسی', ['chs-f-d', 'chs-f-p', 'chs-r-d', 'chs-r-p', 'rl-f-d', 'rl-f-p', 'rl-r-d', 'rl-r-p']],
  ['پالونی و سینی', ['sill-f', 'sill-r', 'tray']],
];

/**
 * The groups, plus a home for anything the list above forgot.
 *
 * A part that belongs to no group would simply not be on the form, and a
 * missing قطعه is invisible in a way a wrong one is not — the seller cannot
 * declare it, and nobody would notice for months. So the leftovers get their
 * own section rather than disappearing.
 */
function partGroups() {
  const placed = new Set(PART_GROUPS.flatMap(([, keys]) => keys));
  const rest = BODY_PARTS.filter((part) => !placed.has(part.key)).map((part) => part.key);
  return rest.length ? [...PART_GROUPS, ['سایر قطعات', rest]] : PART_GROUPS;
}

/** One group: a header that counts what is marked inside it, and its parts. */
function groupBox([fa, keys], bodyStatus) {
  const marked = keys.filter((key) => bodyStatus[key]).length;
  return html`<details class="bm-group" ${raw(marked ? 'open' : '')}>
    <summary>
      ${fa}
      <span class="bm-gc ${marked ? 'on' : ''}" data-body-count>
        ${marked ? `${faDigits(marked)} مورد` : ''}
      </span>
    </summary>
    <div class="bm-glist">
      ${keys.map((key) => PART_BY_KEY[key] && partRow(PART_BY_KEY[key], bodyStatus))}
    </div>
  </details>`;
}

function partRow(part, bodyStatus) {
  return html`<div class="bm-part">
    <div class="bm-nm">
      <span class="bm-mini ${bodyStatus[part.key] ? `st-${bodyStatus[part.key]}` : ''}"
            data-body-mini="${part.key}"></span>
      ${part.fa}
    </div>
    <div class="bm-chips">
      ${part.allowed.map(
        (status) => html`<button type="button"
          class="bm-chip st-${status} ${bodyStatus[part.key] === status ? 'on' : ''}"
          data-body-chip="${part.key}" data-st="${status}">${PART_STATUS_FA[status]}</button>`
      )}
    </div>
  </div>`;
}

/**
 * The part-by-part form. All state lives in the DOM (rule 3.4): the chips
 * carry their on/off classes, and the single hidden input carries the JSON
 * the submit handler reads. A store write would re-render the form and wipe
 * everything else the seller has typed.
 *
 * The opening question — «بدون رنگ» / «رنگ‌شدگی دارد» — is what stops the
 * silent-default lie: a seller who says the car is marked must mark at least
 * one part before the submit handler accepts it (checked there, where the
 * refusal can point at this section).
 */
export function bodyMatrix(bodyStatus = {}, bodyType = null) {
  const has = Object.keys(bodyStatus).length > 0;
  return html`<div class="bm-form" data-body-form data-body-type="${bodyType || ''}">
    <input type="hidden" name="bodyStatus" value="${JSON.stringify(bodyStatus)}">
    <div class="bm-q">
      <button type="button" class="bm-pq ${has ? '' : 'on'}" data-body-clean>بدون رنگ و تعویض</button>
      <button type="button" class="bm-pq ${has ? 'on' : ''}" data-body-marked>رنگ‌شدگی یا تعویض دارد</button>
      <span class="bm-grade tag ${GRADE_TONE[gradeOf(bodyStatus)]}" data-body-grade>
        ${GRADE_FA[gradeOf(bodyStatus)]}
      </span>
    </div>
    <div class="bm-parts" data-body-parts ${raw(has ? '' : 'hidden')}>
      <p class="bm-hint">گروهِ قطعه را باز کنید و وضعیتش را بزنید. هر قطعه فقط یک وضعیت
        می‌گیرد؛ کلیک دوباره یعنی «سالم». حداقل یک قطعه را علامت بزنید.</p>
      ${partGroups().map((group) => groupBox(group, bodyStatus))}
    </div>
    <!-- After the table on purpose: pinned to the bottom of the screen while
         the table scrolls past above it, so the dot appears the moment the
         chip is pressed, on any screen, without knowing the header's height. -->
    <div class="bm-live" data-body-live>${livePreview(bodyType, bodyStatus)}</div>
  </div>`;
}

/** Reads the table back out of the DOM, for submit handlers. */
export function bodyStatusOf(form) {
  try {
    return JSON.parse(form.bodyStatus.value || '{}');
  } catch {
    return {};
  }
}

/** Whether the seller says the car is marked but has marked nothing yet. */
export function bodyMatrixIncomplete(form) {
  const wrap = form.querySelector('[data-body-form]');
  if (!wrap) return false;
  const saysMarked = wrap.querySelector('[data-body-marked]')?.classList.contains('on');
  return Boolean(saysMarked) && Object.keys(bodyStatusOf(form)).length === 0;
}

/**
 * The map as the seller will see it on the card, redrawn on every chip: a
 * dot landing where they just clicked is the check that they marked the
 * right door. Before a model is chosen there is no shape to draw, so the
 * box says so instead of guessing a sedan.
 */
function livePreview(bodyType, table) {
  if (!bodyType) {
    return html`<p class="bm-nomodel">نقشه‌ی بدنه بعد از انتخاب مدل خودرو همین‌جا نمایش داده می‌شود.</p>`;
  }
  return bodyMapView(bodyType, table, { marked: false });
}

function refresh(wrap, table) {
  wrap.querySelector('input[name="bodyStatus"]').value = JSON.stringify(table);
  const grade = gradeOf(table);
  const badge = wrap.querySelector('[data-body-grade]');
  badge.textContent = GRADE_FA[grade];
  badge.className = `bm-grade tag ${GRADE_TONE[grade]}`;
  const live = wrap.querySelector('[data-body-live]');
  if (live) live.innerHTML = String(livePreview(wrap.dataset.bodyType || null, table));

  // Each closed group says how much is marked inside it, so a table that is
  // folded away never hides a mark from the person who made it.
  wrap.querySelectorAll('.bm-group').forEach((group) => {
    const marked = group.querySelectorAll('.bm-chip.on').length;
    const badge = group.querySelector('[data-body-count]');
    if (!badge) return;
    badge.textContent = marked ? `${faDigits(marked)} مورد` : '';
    badge.classList.toggle('on', marked > 0);
  });
}

/** The form learned (or lost) the model's shape: redraw the preview on it. */
export function setBodyPreviewType(form, bodyType) {
  const wrap = form.querySelector('[data-body-form]');
  if (!wrap) return;
  wrap.dataset.bodyType = bodyType || '';
  const live = wrap.querySelector('[data-body-live]');
  if (live) live.innerHTML = String(livePreview(bodyType || null, bodyStatusOf(form)));
}

/** The chip click — one status per part, second click clears it. */
export function handleBodyChip(el) {
  const wrap = el.closest('[data-body-form]');
  if (!wrap) return;
  const key = el.dataset.bodyChip;
  const status = el.dataset.st;
  const table = JSON.parse(wrap.querySelector('input[name="bodyStatus"]').value || '{}');

  if (table[key] === status) delete table[key];
  else table[key] = status;

  wrap.querySelectorAll(`[data-body-chip="${key}"]`).forEach((chip) => {
    chip.classList.toggle('on', table[key] === chip.dataset.st);
  });
  const mini = wrap.querySelector(`[data-body-mini="${key}"]`);
  mini.className = `bm-mini ${table[key] ? `st-${table[key]}` : ''}`;
  refresh(wrap, table);
}

/** The opening question. Choosing «بدون رنگ» clears the whole table. */
export function handleBodyToggle(el, marked) {
  const wrap = el.closest('[data-body-form]');
  if (!wrap) return;
  wrap.querySelector('[data-body-clean]').classList.toggle('on', !marked);
  wrap.querySelector('[data-body-marked]').classList.toggle('on', marked);
  wrap.querySelector('[data-body-parts]').hidden = !marked;
  if (!marked) {
    wrap.querySelectorAll('.bm-chip.on').forEach((chip) => chip.classList.remove('on'));
    wrap.querySelectorAll('.bm-mini').forEach((mini) => {
      mini.className = 'bm-mini';
    });
    refresh(wrap, {});
  }
}
