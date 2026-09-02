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
 * The cut-outs come from the owner's own sheets in `assets/body/sheets/`.
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

/**
 * Parts a body type simply does not have.
 *
 * A single-cab pickup has one door on each side. Offering «درب عقب راننده» on
 * its form would invite a seller to declare a door the car never had, and the
 * server rejects it anyway — this list keeps the form honest, and mirrors
 * NO_PART in backend/src/modules/car/car.constants.js.
 */
const NO_PART = { PICKUP_SINGLE: ['dr-r-d', 'dr-r-p'] };

/** The parts this body type actually has, as a key → part map. */
export function partsFor(bodyType) {
  const gone = new Set(NO_PART[bodyType] || []);
  return Object.fromEntries(BODY_PARTS.filter((p) => !gone.has(p.key)).map((p) => [p.key, p]));
}

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
  PICKUP: 'وانت دوکابین',
  PICKUP_SINGLE: 'وانت تک‌کابین',
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

// planCrop / sideCrop are the windows on the owner's sheet, in percent of it —
// the crop script reads these very numbers, so the picture and this file
// cannot drift apart.
//
// The dots underneath are in percent of the CROPPED picture: the one on the
// screen. They were measured on it, one part at a time, on every body type —
// the first round stored them in sheet percent, which meant nobody could look
// at «31, 59.5» and say whether it was the chassis or the tyre, and half of
// them were a little of both. Landmarks used, per drawing (also percent of
// the crop): where the bonnet ends, where each door is cut, where the wheel
// arches peak. A fender dot sits in the middle of the panel ABOVE the arch —
// never on the tyre; a door dot sits in the middle of the door's own panel,
// below the window line; the chassis pair sits on one line each side of the
// centre, with the rail tip (سرشاسی) further out along the same line, because
// it is the same rail.
//
// To move one: run scripts/body-dots.py, which draws them onto the real
// crops at the size the page shows them.

const SHEETS = {
  SEDAN: {
    file: 'sedan',
    planSize: [800, 369],
    sideSize: [800, 261],
    planCrop: [18.23, 31.12, 81.49, 70.07],
    sideCrop: [19.61, 71.45, 80.04, 97.7],
    plan: {
      hood: [17, 49.9], roof: [54, 49.9], trunk: [86, 49.9],
      'chs-f-d': [23, 69.2], 'chs-f-p': [23, 30.6], 'chs-r-d': [78, 69.2], 'chs-r-p': [78, 30.6],
      'rl-f-d': [10, 69.2], 'rl-f-p': [10, 30.6], 'rl-r-d': [91, 69.2], 'rl-r-p': [91, 30.6],
      'sill-f': [4, 49.9], 'sill-r': [96, 49.9], tray: [11, 49.9],
    },
    side: { 'fnd-f-d': [23, 39], 'dr-f-d': [40, 56], 'dr-r-d': [62, 56], 'fnd-r-d': [78, 39] },
  },
  HATCHBACK: {
    file: 'hatchback',
    planSize: [800, 402],
    sideSize: [800, 314],
    planCrop: [20.23, 29.83, 79.07, 69.24],
    sideCrop: [21.48, 69.8, 76.17, 98.43],
    plan: {
      hood: [18, 50.3], roof: [55, 50.3], trunk: [87, 50.3],
      'chs-f-d': [23, 69.9], 'chs-f-p': [23, 30.7], 'chs-r-d': [78, 69.9], 'chs-r-p': [78, 30.7],
      'rl-f-d': [10, 69.9], 'rl-f-p': [10, 30.7], 'rl-r-d': [91, 69.9], 'rl-r-p': [91, 30.7],
      'sill-f': [4, 50.3], 'sill-r': [96, 50.3], tray: [11, 50.3],
    },
    side: { 'fnd-f-d': [21, 41], 'dr-f-d': [42, 56], 'dr-r-d': [63, 56], 'fnd-r-d': [79, 41] },
  },
  SUV: {
    file: 'suv',
    planSize: [800, 354],
    sideSize: [800, 304],
    planCrop: [17.96, 30.2, 81.42, 67.68],
    sideCrop: [21.27, 69.24, 77.35, 97.7],
    plan: {
      hood: [18, 50], roof: [54, 50], trunk: [87, 50],
      'chs-f-d': [23, 68.9], 'chs-f-p': [23, 31.1], 'chs-r-d': [78, 68.9], 'chs-r-p': [78, 31.1],
      'rl-f-d': [10, 68.9], 'rl-f-p': [10, 31.1], 'rl-r-d': [91, 68.9], 'rl-r-p': [91, 31.1],
      'sill-f': [4, 50], 'sill-r': [96, 50], tray: [11, 50],
    },
    side: { 'fnd-f-d': [20, 40], 'dr-f-d': [41, 56], 'dr-r-d': [61, 56], 'fnd-r-d': [76, 40] },
  },
  PICKUP: {
    file: 'pickup',
    planSize: [800, 351],
    sideSize: [800, 285],
    planCrop: [19.82, 31.03, 79.14, 65.75],
    sideCrop: [17.4, 67.13, 82.04, 97.88],
    plan: {
      hood: [16, 50.7], roof: [45, 50.7], trunk: [79, 50.7],
      'chs-f-d': [22, 69.4], 'chs-f-p': [22, 32], 'chs-r-d': [72, 69.4], 'chs-r-p': [72, 32],
      'rl-f-d': [9, 69.4], 'rl-f-p': [9, 32], 'rl-r-d': [92, 69.4], 'rl-r-p': [92, 32],
      'sill-f': [4, 50.7], 'sill-r': [96, 50.7], tray: [11, 50.7],
    },
    side: { 'fnd-f-d': [18, 40], 'dr-f-d': [37, 56], 'dr-r-d': [54, 56], 'fnd-r-d': [78, 40] },
  },
  // The single cab has one door a side, so it has no درب عقب at all — see
  // NO_PART below, which takes the pair off the form and out of the list.
  PICKUP_SINGLE: {
    file: 'takkabin',
    planSize: [800, 337],
    sideSize: [800, 280],
    planCrop: [18.6, 31.8, 80.8, 66.2],
    sideCrop: [16.8, 68, 82.8, 98.9],
    plan: {
      hood: [17, 50.3], roof: [44, 50.3], trunk: [78, 50.3],
      'chs-f-d': [22, 68.8], 'chs-f-p': [22, 31.8], 'chs-r-d': [72, 68.8], 'chs-r-p': [72, 31.8],
      'rl-f-d': [9, 68.8], 'rl-f-p': [9, 31.8], 'rl-r-d': [92, 68.8], 'rl-r-p': [92, 31.8],
      'sill-f': [4, 50.3], 'sill-r': [96, 50.3], tray: [11, 50.3],
    },
    side: { 'fnd-f-d': [20, 40], 'dr-f-d': [37, 55], 'fnd-r-d': [72, 40] },
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

/** One dot, where the numbers say — mirrored for the flipped passenger view. */
function dot([x, y], status, title, mirror = false) {
  return html`<span class="bm-dot st-${status}" title="${title}"
    style="left:${mirror ? 100 - x : x}%;top:${y}%"></span>`;
}

/**
 * The read-only map: three views of this body type with one dot per marked
 * part, a legend, and the marked parts spelled out — because a coloured dot
 * answers «where», and the sentence under it answers «what».
 */
export function bodyMapView(bodyType, bodyStatus = {}, { marked: showMarked = true } = {}) {
  const sheet = SHEETS[bodyType] || SHEETS.SEDAN;
  // Everything the seller marked stays in the written list even if this
  // drawing has nowhere to put a dot for it — a mark that quietly vanished
  // would be worse than one without a dot.
  const marked = Object.entries(bodyStatus).filter(([key]) => PART_BY_KEY[key]);

  const planDots = [];
  const driverDots = [];
  const passengerDots = [];
  for (const [key, status] of marked) {
    const title = `${PART_BY_KEY[key].fa} — ${PART_STATUS_FA[status] || status}`;
    const twin = DRIVER_TWIN[key];
    if (sheet.plan[key]) planDots.push(dot(sheet.plan[key], status, title));
    else if (sheet.side[key]) driverDots.push(dot(sheet.side[key], status, title));
    else if (twin && sheet.side[twin]) {
      passengerDots.push(dot(sheet.side[twin], status, title, true));
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
                <span class="bm-sw st-${status}"></span>
                <b>${PART_BY_KEY[key].fa}</b>
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
function partGroups(bodyType) {
  const parts = partsFor(bodyType);
  const groups = PART_GROUPS.map(([fa, keys]) => [fa, keys.filter((key) => parts[key])]);
  const placed = new Set(PART_GROUPS.flatMap(([, keys]) => keys));
  const rest = Object.keys(parts).filter((key) => !placed.has(key));
  if (rest.length) groups.push(['سایر قطعات', rest]);
  return groups.filter(([, keys]) => keys.length);
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
      <div data-body-groups>
        ${partGroups(bodyType).map((group) => groupBox(group, bodyStatus))}
      </div>
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

/**
 * The form learned (or lost) the model's shape: redraw the preview on it, and
 * the table too — a single cab has no rear doors, so picking one has to take
 * those two rows away (and any mark already on them) rather than leave a
 * seller declaring a door the car never had.
 */
export function setBodyPreviewType(form, bodyType) {
  const wrap = form.querySelector('[data-body-form]');
  if (!wrap) return;
  const was = wrap.dataset.bodyType || '';
  wrap.dataset.bodyType = bodyType || '';

  const table = bodyStatusOf(form);
  const groups = wrap.querySelector('[data-body-groups]');
  if (groups && was !== (bodyType || '')) {
    const parts = partsFor(bodyType);
    for (const key of Object.keys(table)) if (!parts[key]) delete table[key];
    groups.innerHTML = String(partGroups(bodyType).map((group) => groupBox(group, table)).join(''));
    refresh(wrap, table);
    return;
  }
  const live = wrap.querySelector('[data-body-live]');
  if (live) live.innerHTML = String(livePreview(bodyType || null, table));
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
