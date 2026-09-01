import { html, raw } from '../../ui/html.js';
import { icon } from '../../ui/icons.js';
import { car, catalog, havale } from '../../api/index.js';
import { getState } from '../../state/store.js';
import { money, faDigits, until, enDigits } from '../../ui/format.js';
import {
  emptyBox, toast, openModal, afterModalCloses, qtip, formErrorSlot, showFormError,
  clearFormError, pager,
} from '../../ui/feedback.js';
import { pickSelect, syncPickSelect } from '../../ui/pickSelect.js';
import { brandPickValue } from '../../ui/brandPicker.js';
import { brandFilter } from '../../ui/brandFilter.js';
import { filterBox, countFilters } from '../../ui/filterBox.js';
import { checkChips } from '../../ui/checkChips.js';
import { metaRows, lockNote } from '../../ui/cardMeta.js';
import { moneyInput, moneyFieldId } from '../../ui/moneyInput.js';
import {
  bodyMatrix, bodyMapView, bodyStatusOf, bodyMatrixIncomplete, setBodyPreviewType,
  GRADE_FA, GRADE_TONE, BODY_TYPE_FA,
} from '../../ui/bodyMap.js';
import { editedTag } from './listings.js';
import { go, resolve } from '../../router.js';

/**
 * The خودرو market, from the agency's side.
 *
 * A finished car — zero-kilometre or used — offered or sought. It reads like
 * the two markets before it on purpose: the same hidden contact, the same
 * shared allowance, the same «آگهی‌های من». What is its own: the body-status
 * map (the market's heart), photographs behind the reveal, and a full
 * catalogue with no brand gate — a car on the lot is anybody's to sell.
 */

export const CAR_KIND_LABEL = {
  OFFER: 'فروش خودرو',
  REQUEST: 'درخواست خرید',
};

const TOLERANCE_FA = {
  NO_PAINT_ONLY: 'فقط بدون رنگ',
  MINOR_OK: 'تا رنگ جزئی',
  ANY: 'فرقی نمی‌کند',
};

const WARRANTY_FA = { true: 'فعال', false: 'غیرفعال' };

function warrantyLabel(value) {
  if (value === true || value === false) return WARRANTY_FA[value];
  return 'نامشخص';
}

// ── loaders ─────────────────────────────────────────────────────────────────

export async function loadCarSearch(params) {
  const [list, tree, usage, pickedModels] = await Promise.all([
    car.list({
      kind: params.kind,
      brandIds: params.brandIds,
      carModelIds: params.carModelIds,
      bodyType: params.bodyType,
      yearFrom: params.yearFrom,
      yearTo: params.yearTo,
      priceFrom: params.priceFrom,
      priceTo: params.priceTo,
      maxMileage: params.maxMileage,
      grades: params.grades,
      warranty: params.warranty,
      sort: params.sort,
      page: params.page || 1,
      limit: 12,
    }),
    catalog.get(),
    havale.usage().catch(() => null),
    // The ticked models, with the brand each sits under: an address that was
    // shared or bookmarked carries only their ids, and the picker groups them
    // by brand before it can put the ticks back.
    pickedModelsOf(params.carModelIds),
  ]);
  return { list, tree, usage, pickedModels };
}

/** @returns {Promise<Array<{id: string, brandId: string}>>} */
export async function pickedModelsOf(ids) {
  if (!ids) return [];
  const res = await catalog.models(ids).catch(() => null);
  return res?.models || [];
}

export async function loadCarForm() {
  return { tree: await catalog.get() };
}

export async function loadCarMine(params) {
  const reseller = Boolean(getState().user?.isReseller);
  const scope = reseller ? params.scope || 'all' : undefined;
  const [mine, tree] = await Promise.all([
    car.mine({ status: params.status, scope, page: params.page || 1, limit: 20 }),
    // The edit dialogue opens from this page and needs the colour list.
    catalog.get(),
  ]);
  return { mine, tree };
}

// ── the market ──────────────────────────────────────────────────────────────

/**
 * How the results may be ordered — the same four words the API takes.
 *
 * «جدیدترین» carries no `sort` in the address, so a plain link to the market
 * and the default order are the same address.
 */
const SORTS = [
  ['new', 'جدیدترین'],
  ['cheap', 'ارزان‌ترین'],
  ['expensive', 'گران‌ترین'],
  ['km', 'کم‌کارکردترین'],
];

/** Everything in the address that is a filter — not the kind, order or page. */
const FILTER_KEYS = [
  'brandIds', 'carModelIds', 'bodyType', 'yearFrom', 'yearTo',
  'priceFrom', 'priceTo', 'maxMileage', 'grades', 'warranty',
];

/**
 * The current search with one thing changed.
 *
 * Every tab and sort button is a link to this same page, so each has to carry
 * the whole search with it — the kind tabs used to carry only the kind, and
 * choosing «فروش» silently threw away the filters underneath.
 */
function searchLink(params, patch) {
  const next = { ...withoutPage(params), ...patch };
  for (const key of Object.keys(next)) if (!next[key]) delete next[key];
  return new URLSearchParams(next).toString();
}

export function carSearchPage() {
  const { data, params } = getState();
  const items = data.list?.items || [];
  const total = data.list?.total || 0;
  const brands = data.tree?.brands || [];

  const kinds = [
    ['', 'همه'],
    ['OFFER', 'فروش'],
    ['REQUEST', 'درخواست‌ها'],
  ];

  return html`
  <div class="card">
    <div class="card-h">
      <h2>استعلام خودرو ${qtip('خودروهایی که نمایندگی‌های دیگر برای فروش گذاشته‌اند و درخواست‌های خریدشان. شماره‌ی تماس، عکس‌ها و توضیحاتِ فروشنده با «نمایش مشخصات» باز می‌شود — یک واحد از سقف روزانه‌ی مشترک شما.')}</h2>
      <div class="kind-tabs">
        ${kinds.map(
          ([value, label]) => html`<button class="tab ${(params.kind || '') === value ? 'on' : ''}"
            data-go="car-search" data-go-params="${searchLink(params, { kind: value })}">${label}</button>`
        )}
      </div>
    </div>

    <!-- What matched, and in what order — above the filters, because the
         answer is what the page is for. -->
    <div class="list-bar">
      <span class="found">
        ${
          total
            ? html`<b class="num">${faDigits(total)}</b> آگهی`
            : 'آگهی‌ای با این فیلترها نیست'
        }
      </span>
      <div class="sorts">
        ${SORTS.map(
          ([value, label]) => html`<button class="sort ${(params.sort || 'new') === value ? 'on' : ''}"
            data-go="car-search"
            data-go-params="${searchLink(params, { sort: value === 'new' ? '' : value })}">${label}</button>`
        )}
      </div>
    </div>

    ${filterBox(countFilters(params, FILTER_KEYS), html`
    <form class="filters" data-form="car-filters">
      <div class="field wide">
        ${brandFilter(brands, { brandIds: params.brandIds, pickedModels: data.pickedModels })}
      </div>
      <div class="field">
        <label for="yearFrom">سال ساخت از</label>
        <input class="in num" id="yearFrom" name="yearFrom" inputmode="numeric" maxlength="4"
               placeholder="۱۴۰۰" value="${params.yearFrom || ''}">
      </div>
      <div class="field">
        <label for="yearTo">سال ساخت تا</label>
        <input class="in num" id="yearTo" name="yearTo" inputmode="numeric" maxlength="4"
               placeholder="۱۴۰۵" value="${params.yearTo || ''}">
      </div>
      <div class="field">
        <label for="${moneyFieldId('priceFrom')}">قیمت از (تومان)</label>
        ${moneyInput('priceFrom', { value: params.priceFrom || '' })}
      </div>
      <div class="field">
        <label for="${moneyFieldId('priceTo')}">قیمت تا (تومان)</label>
        ${moneyInput('priceTo', { value: params.priceTo || '' })}
      </div>
      <div class="field">
        <label for="maxMileage">حداکثر کارکرد</label>
        <select class="in" id="maxMileage" name="maxMileage">
          <option value="">فرقی نمی‌کند</option>
          ${[
            ['0', 'فقط صفر کیلومتر'],
            ['30000', 'تا ۳۰ هزار'],
            ['60000', 'تا ۶۰ هزار'],
            ['100000', 'تا ۱۰۰ هزار'],
            ['200000', 'تا ۲۰۰ هزار'],
          ].map(
            ([value, label]) =>
              html`<option value="${value}" ${raw(params.maxMileage === value ? 'selected' : '')}>${label}</option>`
          )}
        </select>
      </div>
      <div class="field wide">
        <label>نوع بدنه <span class="opt">(چندتایی)</span></label>
        ${checkChips('bodyType', Object.entries(BODY_TYPE_FA), params.bodyType)}
      </div>
      <div class="field wide">
        <label>وضعیت بدنه <span class="opt">(چندتایی — مثلاً رنگ‌شده + تعویض‌دار)</span></label>
        ${checkChips('grades', Object.entries(GRADE_FA), params.grades)}
      </div>
      <div class="field">
        <label class="fcheck">
          <input type="checkbox" name="warranty" value="1" ${raw(params.warranty === '1' ? 'checked' : '')}>
          فقط گارانتی فعال
        </label>
      </div>
      <div class="actions">
        <button class="btn primary" type="submit">اعمال</button>
        <button class="btn" type="button" data-go="car-search">پاک کردن</button>
      </div>
    </form>`)}
  </div>

  ${
    items.length
      ? html`<div class="grid">${items.map(card)}</div>`
      : emptyBox('خودرویی با این فیلترها پیدا نشد.')
  }

  ${pager({
    page: data.list?.page || 1,
    pages: data.list?.pages || 1,
    go: 'car-search',
    params: withoutPage(params),
  })}`;
}

/** The same filters with the page dropped — the pager re-adds its own. */
function withoutPage(params) {
  const rest = { ...params };
  delete rest.page;
  return rest;
}

function card(c) {
  const offer = c.kind === 'OFFER';
  return html`
  <article class="hcard car ${c.isOwn ? 'own' : ''}">
    <header>
      <div>
        <span class="tag ${offer ? '' : 'c'}">${CAR_KIND_LABEL[c.kind]}</span>
        ${editedTag(c)}
        <h3>${c.carType}</h3>
      </div>
      ${
        // A request has no body to grade. Its corner says what the buyer
        // will accept, under that name — not «وضعیت بدنه» over a car that
        // does not exist yet.
        offer
          ? html`<span class="solh ${GRADE_TONE[c.bodyGrade] === 'g' ? 'is-solh' : 'is-vek'}">
              <span class="solh-k">وضعیت بدنه</span>
              <b>${GRADE_FA[c.bodyGrade] || '—'}</b>
            </span>`
          : html`<span class="solh is-solh">
              <span class="solh-k">بدنه‌ی قابل قبول</span>
              <b>${TOLERANCE_FA[c.paintTolerance] || 'فرقی نمی‌کند'}</b>
            </span>`
      }
    </header>

    <!-- «عنوان … پاسخ», one line per fact, in two groups: what the car is,
         then who is selling it and until when. It was a row of bare chips for
         a while — shorter, and unreadable, because «تا ۸۰ هزار کیلومتر»
         floating on its own does not say which number it is. What the chips
         fixed stays fixed: a label and its answer share a line.

         Every card of a kind carries the same rows in the same order, and a
         row with nothing in it says «—» rather than disappearing: a list of
         cards is read down the labels, and a label that comes and goes moves
         every line under it. -->
    <dl>
      ${
        offer
          ? field('قیمت خودرو', c.carPriceToman ? money(c.carPriceToman) : 'اعلام نشده', 'big')
          : field('حداکثر قیمت', c.carPriceToman ? money(c.carPriceToman) : 'سقف ندارد', 'big')
      }
      ${
        offer
          ? field('سال ساخت', c.year ? faDigits(c.year) : '—')
          : field(
              'سال ساخت',
              c.yearFrom || c.yearTo
                ? `${c.yearFrom ? faDigits(c.yearFrom) : '…'} تا ${c.yearTo ? faDigits(c.yearTo) : '…'}`
                : 'فرقی نمی‌کند'
            )
      }
      ${
        offer
          ? field('کارکرد', mileageShort(c.mileageKm) || '—')
          : field(
              'کارکرد',
              c.maxMileageKm === null ? 'فرقی نمی‌کند' : `تا ${mileageShort(c.maxMileageKm)}`
            )
      }
      ${offer ? field('رنگ', c.carColor || '—') : ''}
      ${offer ? field('گارانتی', warrantyLabel(c.warranty)) : ''}
      ${field('نوع بدنه', BODY_TYPE_FA[c.bodyType] || '—')}
    </dl>

    <dl class="card-meta">${metaRows(c)}</dl>

    ${c.description ? html`<p class="desc">${c.description}</p>` : ''}

    <footer>
      ${
        c.agency || c.isOwn
          ? ''
          : lockNote(c.hasDescription || c.photoCount ? 'نمایندگی، عکس‌ها و توضیحات' : 'نمایندگی')
      }
      <!-- The strip only when there is something on it. Before the reveal it
           said «اطلاعات تماس مخفی است» under a line that had just said the
           same thing, and cost the card a whole row to do it. -->
      ${c.isOwn || c.contact ? carContact(c) : ''}
      <div class="card-actions">
        <button class="btn sm" data-open-car="${c.id}">${offer ? 'جزئیات و نقشه بدنه' : 'جزئیات'}</button>
        ${
          c.isOwn || c.contact
            ? ''
            : html`<button class="btn primary sm" data-car-reveal="${c.id}">نمایش مشخصات</button>`
        }
      </div>
    </footer>
  </article>`;
}

function field(label, value, tone = '') {
  return html`<div><dt>${label}</dt><dd class="num ${tone}">${value}</dd></div>`;
}

function mileage(km) {
  if (km === null || km === undefined) return '—';
  if (km === 0) return 'صفر';
  return `${faDigits(Number(km).toLocaleString('en-US'))} کیلومتر`;
}

/**
 * The same number for the card's one-line facts.
 *
 * «۱۲۰,۰۰۰ کیلومتر» is eleven characters of chip for a number the reader
 * compares in tens of thousands. Hundreds are still spelled out — «۸,۵۰۰
 * کیلومتر» is a fact about a nearly new car and must not round to «۹ هزار».
 */
function mileageShort(km) {
  if (km === null || km === undefined) return null;
  if (km === 0) return 'صفر کیلومتر';
  if (km < 10000) return `${faDigits(Number(km).toLocaleString('en-US'))} کیلومتر`;
  return `${faDigits(Math.round(km / 1000))} هزار کیلومتر`;
}

/**
 * The contact strip, on the card and inside the detail panel.
 *
 * `inModal` drops the one control that would navigate: leaving the page while
 * a modal is open leaves the modal hanging over whatever comes next.
 */
function carContact(c, { inModal = false } = {}) {
  if (c.isOwn) {
    return html`<div class="contact own">
      <span>آگهی خودتان — ${faDigits(c.revealCount || 0)} بازدید</span>
      ${inModal ? '' : html`<button class="btn sm" data-go="car-mine">آگهی‌های من</button>`}
    </div>`;
  }

  if (c.contact) {
    return html`<div class="contact shown">
      <div>
        <b>${c.contact.coordinatorName}</b>
        <a class="num phone" href="tel:${c.contact.coordinatorPhone}">${c.contact.coordinatorPhone}</a>
      </div>
      <button class="btn sm" data-report="${c.id}">گزارش تخلف</button>
    </div>`;
  }

  return html`<div class="contact hidden">
    <span>اطلاعات تماس مخفی است</span>
    <button class="btn primary sm" data-car-reveal="${c.id}">نمایش مشخصات</button>
  </div>`;
}

/**
 * A card whose advertisement is no longer there.
 *
 * Between the page being drawn and the click, an advertisement can be
 * withdrawn, sold, or its agency suspended — and the card is still on screen,
 * answering 404 to everything pressed on it. Saying so plainly and reloading
 * the list is what turns a dead card into a page that corrects itself.
 */
async function carGone(err) {
  if (err.code !== 'NOT_FOUND') return false;
  toast('این آگهی دیگر در دسترس نیست — احتمالاً برداشته شده است.', 'danger');
  await resolve();
  return true;
}

/** Confirms first: the allowance is small, shared across markets, not refundable. */
export function confirmCarReveal(id) {
  const { data } = getState();
  const usage = data.usage;
  const left = usage ? Math.max(0, usage.dailyLimit - usage.dailyUsed) : null;

  openModal({
    type: 'confirm',
    title: 'نمایش اطلاعات تماس',
    body: html`
      <p>با نمایش این مشخصات، <b>یک واحد از سقف روزانه‌ی شما</b> مصرف می‌شود — همان سقف
      مشترک هر سه بازار. عکس‌ها و توضیحات فروشنده هم همراهش باز می‌شود.</p>
      ${left !== null ? html`<p>باقی‌مانده‌ی امروز: <b class="num">${faDigits(left)}</b></p>` : ''}
      <p style="color:var(--ink-3);font-size:12px">باز کردن دوباره‌ی همین آگهی رایگان است.</p>`,
    confirmLabel: 'نمایش بده',
    onConfirm: async () => {
      try {
        await car.reveal(id);
        toast('مشخصات تماس نمایش داده شد');
        await resolve();
        // What the view was just paid for — the photographs, the seller's
        // description, the contact — opens by itself. Asking the buyer to
        // find «جزئیات و نقشه بدنه» again after paying is asking them to
        // hunt for something they already bought.
        afterModalCloses(() => openCarModal(id));
      } catch (err) {
        if (!(await carGone(err))) toast(err.message, 'danger');
      }
    },
  });
}

/**
 * The detail dialogue — where the body map lives.
 *
 * Fetched fresh rather than read from the list: the reader may have revealed
 * this advertisement a minute ago, and the map page must show the photos that
 * reveal paid for.
 */
export async function openCarModal(id) {
  let c;
  try {
    c = await car.get(id);
  } catch (err) {
    if (!(await carGone(err))) toast(err.message, 'danger');
    return undefined;
  }

  const offer = c.kind === 'OFFER';
  openModal({
    type: 'info',
    title: `${c.carType}${c.year ? ` — ${faDigits(c.year)}` : ''}`,
    wide: true,
    body: html`
      <dl class="modal-specs">
        ${field('نوع بدنه', BODY_TYPE_FA[c.bodyType] || '—')}
        ${offer ? field('کارکرد', mileage(c.mileageKm)) : ''}
        ${offer ? field('رنگ', c.carColor || '—') : ''}
        ${offer ? field('گارانتی', warrantyLabel(c.warranty)) : ''}
        ${field(offer ? 'قیمت خودرو' : 'تا قیمت', c.carPriceToman ? money(c.carPriceToman) : '—')}
        ${offer ? field('وضعیت بدنه', GRADE_FA[c.bodyGrade] || '—') : field('بدنه‌ی قابل قبول', TOLERANCE_FA[c.paintTolerance] || '—')}
      </dl>

      ${offer ? bodyMapView(c.bodyType, c.bodyStatus) : ''}

      <!-- The photographs, or a sentence about them. The card used to carry
           «۳ عکس 🔒» as if it were a specification of the car; what a reader
           needs is not the number on the card but the way to see them, said
           where they would be. -->
      ${
        c.photos?.length
          ? html`<div class="car-photos">
              ${c.photos.map((p) => html`<a href="${p.url}" target="_blank" rel="noopener"><img src="${p.url}" alt="عکس خودرو" loading="lazy"></a>`)}
            </div>`
          : offer && c.photoCount && !c.contactRevealed
            ? html`<p class="hint" style="margin:10px 0 0">
                این آگهی ${faDigits(c.photoCount)} عکس دارد — برای مشاهده‌ی عکس‌ها
                «نمایش مشخصات» را بزنید.
              </p>`
            : ''
      }

      ${c.description ? html`<p class="desc" style="margin-top:10px">${c.description}</p>` : ''}
      ${
        !c.contactRevealed && c.hasDescription && !c.description
          ? html`<p class="hint" style="margin:8px 0 0">توضیحات فروشنده با «نمایش مشخصات» باز می‌شود.</p>`
          : ''
      }
      <!-- The same block the card carries, so «نمایش مشخصات» is within reach
           of whatever it unlocks rather than behind the panel. -->
      ${carContact(c, { inModal: true })}`,
  });
  return undefined;
}

// ── the forms ───────────────────────────────────────────────────────────────

export function carFormPage(kind) {
  const { data } = getState();
  const offer = kind === 'OFFER';
  const brands = data.tree?.brands || [];
  const colors = data.tree?.colors || [];

  return html`
  <form class="card form" data-form="car" data-kind="${kind}">
    <div class="card-h">
      <h2>
        ${offer ? 'ثبت آگهی فروش خودرو' : 'ثبت درخواست خرید خودرو'}
        ${qtip(
          offer
            ? 'خودرویی که دارید و می‌فروشید — صفر یا کارکرده، از هر برندی. شماره‌ی شما روی آگهی نوشته نمی‌شود؛ عکس‌ها و توضیحات هم فقط بعد از «نمایش مشخصات» دیده می‌شوند.'
            : 'خودرویی که دنبالش هستید. درخواست شما برای همه‌ی نمایندگی‌ها دیده می‌شود تا هر کس دارد با شما تماس بگیرد.'
        )}
      </h2>
    </div>

    <div style="padding:0 14px">${formErrorSlot()}</div>

    <div class="fields">
      <div class="field">
        <label for="brand">برند</label>
        ${pickSelect(
          'brand',
          // The full catalogue, both sides: this market has no brand gate.
          brands.map((b) => ({
            value: b.id,
            label: `${b.name}${b.company ? ` — ${b.company.name}` : ''}`,
            search: b.slug || '',
          })),
          { required: true, searchLabel: 'نام برند — مثلاً پژو یا peugeot' }
        )}
      </div>

      <div class="field">
        <label for="carModelId">مدل خودرو</label>
        ${pickSelect('carModelId', [], {
          required: true,
          disabled: true,
          placeholder: 'ابتدا برند را انتخاب کنید',
          searchLabel: 'نام مدل…',
        })}
        <div class="hint">اگر مدلی در فهرست نیست، از پشتیبانی بخواهید اضافه شود.</div>
      </div>

      <div class="field">
        <label for="bodyTypeShow">نوع بدنه</label>
        <input class="in" id="bodyTypeShow" value="از روی مدل تعیین می‌شود" readonly
               style="background:#efeadd;cursor:not-allowed" data-body-type-show>
        <div class="hint">نوع بدنه به مدل چسبیده است و قابل انتخاب نیست — نقشه‌ی بدنه از همین می‌آید.</div>
      </div>

      ${
        offer
          ? html`
            <div class="field">
              <label for="year">سال ساخت (شمسی)</label>
              <input class="in num" id="year" name="year" inputmode="numeric" maxlength="4"
                     required placeholder="مثلاً ۱۴۰۲">
            </div>
            <div class="field">
              <label for="mileageKm">کارکرد (کیلومتر)</label>
              <input class="in num" id="mileageKm" name="mileageKm" inputmode="numeric" maxlength="7"
                     required placeholder="صفر کیلومتر: ۰">
            </div>
            <div class="field">
              <label for="carColor">رنگ بدنه</label>
              <select class="in" id="carColor" name="carColor" required>
                <option value="">انتخاب کنید</option>
                ${colors.map((color) => html`<option value="${color.name}">${color.name}</option>`)}
              </select>
            </div>
            <div class="field">
              <label for="warranty">گارانتی</label>
              <select class="in" id="warranty" name="warranty" required>
                <option value="">انتخاب کنید</option>
                <option value="true">فعال</option>
                <option value="false">غیرفعال</option>
              </select>
            </div>
            <div class="field">
              <label for="${moneyFieldId('carPriceToman')}">قیمت خودرو (تومان)</label>
              ${moneyInput('carPriceToman', { required: true })}
            </div>`
          : html`
            <div class="field">
              <label for="yearFrom">سال ساخت از <span class="opt">(اختیاری)</span></label>
              <input class="in num" id="yearFrom" name="yearFrom" inputmode="numeric" maxlength="4"
                     placeholder="مثلاً ۱۴۰۰">
            </div>
            <div class="field">
              <label for="yearTo">سال ساخت تا <span class="opt">(اختیاری)</span></label>
              <input class="in num" id="yearTo" name="yearTo" inputmode="numeric" maxlength="4"
                     placeholder="مثلاً ۱۴۰۵">
            </div>
            <div class="field">
              <label for="maxMileageKm">حداکثر کارکرد (کیلومتر) <span class="opt">(اختیاری)</span></label>
              <input class="in num" id="maxMileageKm" name="maxMileageKm" inputmode="numeric" maxlength="7"
                     placeholder="مثلاً ۶۰۰۰۰">
            </div>
            <div class="field">
              <label for="${moneyFieldId('priceFromToman')}">قیمت از (تومان) <span class="opt">(اختیاری)</span></label>
              ${moneyInput('priceFromToman')}
            </div>
            <div class="field">
              <label for="${moneyFieldId('carPriceToman')}">قیمت تا (تومان) <span class="opt">(اختیاری)</span></label>
              ${moneyInput('carPriceToman')}
            </div>
            <div class="field">
              <label for="paintTolerance">وضعیت بدنه‌ی قابل قبول</label>
              <select class="in" id="paintTolerance" name="paintTolerance">
                ${Object.entries(TOLERANCE_FA)
                  .reverse()
                  .map(([value, label]) => html`<option value="${value}">${label}</option>`)}
              </select>
            </div>`
      }
    </div>

    ${
      offer
        ? html`
          <div class="card-h" style="border-top:1px solid var(--line-2)">
            <h2>وضعیت بدنه ${qtip('قطعه‌هایی که رنگ، تعویض یا آسیب دارند را علامت بزنید — همین‌جا روی نقشه با نقطه‌های رنگی می‌نشیند، همان‌طور که خریدار می‌بیند. قطعه‌ی سالم را کاری نداشته باشید.')}</h2>
          </div>
          <div style="padding:0 14px 8px">${bodyMatrix()}</div>

          <div class="card-h" style="border-top:1px solid var(--line-2)">
            <h2>عکس خودرو <span class="opt">(اختیاری، تا ۶ عکس)</span></h2>
          </div>
          <div style="padding:8px 14px 4px">
            <!-- The bare <input type="file"> renders as the browser's English
                 «Choose Files» button; the input hides behind a house-styled
                 label instead, the same trick the ticket paperclip uses. -->
            <label class="btn sm tk-clip" title="تا ۶ عکس، JPG یا PNG یا WebP">
              ${icon('file', 15)} انتخاب عکس‌ها
              <input type="file" name="photos" hidden
                     accept="image/jpeg,image/png,image/webp" multiple data-attach-input>
            </label>
            <span class="tk-attach-names hint" data-attach-names></span>
            <div class="hint">
              عکس‌ها روی کارت عمومی نمایش داده نمی‌شوند و بعد از «نمایش مشخصات» به خریدار می‌رسند —
              روی شیشه می‌شود شماره نوشت، پس عکس هم مثل متن آزاد پشت پرداخت است.
            </div>
          </div>`
        : ''
    }

    <div class="fields">
      <div class="field wide">
        <label for="description">توضیحات <span class="opt">(اختیاری)</span></label>
        <textarea class="in" id="description" name="description" rows="3" maxlength="1000"
                  placeholder="${offer ? 'مثلاً: سرویس‌ها به‌موقع، لاستیک نو…' : ''}"></textarea>
      </div>
    </div>

    <div class="form-foot">
      <div class="hint">
        شماره‌ی تماس شما روی آگهی نوشته نمی‌شود؛ هر کس بخواهد ببیند از سهمیه‌ی خودش خرج می‌کند.
      </div>
      <button class="btn primary" type="submit">${offer ? 'ثبت آگهی' : 'ثبت درخواست'}</button>
    </div>
  </form>`;
}

/** The model list follows the brand — full catalogue, no gate. */
export async function onCarBrandChange(form) {
  const brandId = form.brand?.value ?? form.brandId?.value;
  const select = form.carModelId;
  if (!select) return;

  select.innerHTML = '';
  select.disabled = true;

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = brandId ? 'در حال بارگذاری…' : 'ابتدا برند را انتخاب کنید';
  select.appendChild(placeholder);
  syncPickSelect(select);
  showBodyType(form, null);
  if (!brandId) return;

  let models = [];
  try {
    ({ models } = await catalog.brandModels(brandId));
  } catch {
    placeholder.textContent = 'بارگذاری مدل‌ها نشد — دوباره برند را انتخاب کنید';
    syncPickSelect(select);
    return;
  }

  const current = form.brand?.value ?? form.brandId?.value;
  if (current !== brandId) return;

  placeholder.textContent = 'انتخاب کنید';
  select.disabled = false;
  models.forEach((model) => {
    const option = document.createElement('option');
    option.value = model.id;
    option.textContent = model.name;
    // The catalogue's own verdict rides on the option, so choosing a model
    // can show its shape without another request.
    option.dataset.body = model.bodyType || '';
    select.appendChild(option);
  });
  syncPickSelect(select);
}

/** Choosing a model shows its catalogue-decided shape, read-only. */
export function onCarModelChange(form) {
  const select = form.carModelId;
  const option = select?.selectedOptions?.[0];
  showBodyType(form, option?.dataset.body ?? null);
}

function showBodyType(form, bodyType) {
  const box = form.querySelector('[data-body-type-show]');
  if (!box) return;
  if (bodyType === null || form.carModelId?.value === '') {
    box.value = 'از روی مدل تعیین می‌شود';
    setBodyPreviewType(form, null);
  } else {
    // Unclassified reads as سدان, the same fallback the server applies.
    const shape = bodyType || 'SEDAN';
    box.value = BODY_TYPE_FA[shape] || BODY_TYPE_FA.SEDAN;
    setBodyPreviewType(form, shape);
  }
}

export async function submitCar(form) {
  const kind = form.dataset.kind;
  const offer = kind === 'OFFER';
  const payload = { kind, carModelId: form.carModelId.value };

  const entered = (name) => form.elements[name]?.value || '';

  if (offer && bodyMatrixIncomplete(form)) {
    return showFormError(form, {
      message: 'گفته‌اید خودرو رنگ‌شدگی دارد ولی هیچ قطعه‌ای علامت نخورده — یا قطعه‌ها را علامت بزنید یا «بدون رنگ و تعویض» را انتخاب کنید.',
    });
  }

  const numbers = offer
    ? { year: entered('year'), mileageKm: entered('mileageKm'), carPriceToman: entered('carPriceToman') }
    : {
        yearFrom: entered('yearFrom'),
        yearTo: entered('yearTo'),
        maxMileageKm: entered('maxMileageKm'),
        priceFromToman: entered('priceFromToman'),
        carPriceToman: entered('carPriceToman'),
      };
  Object.entries(numbers).forEach(([key, value]) => {
    if (value !== '') payload[key] = Number(enDigits(value));
  });

  if (offer) {
    payload.carColor = entered('carColor');
    payload.warranty = entered('warranty') === 'true';
    payload.bodyStatus = bodyStatusOf(form);
  } else {
    payload.paintTolerance = entered('paintTolerance') || 'ANY';
  }
  if (entered('description')) payload.description = entered('description');

  clearFormError(form);

  let row;
  try {
    row = await car.create(payload);
  } catch (err) {
    return showFormError(form, err);
  }

  // The photos ride after the row exists. A failure here must not eat the
  // advertisement that was just accepted: it is reported, and the photos can
  // be added again from «آگهی‌های من».
  const files = form.elements.photos?.files;
  if (offer && files?.length) {
    const body = new FormData();
    [...files].slice(0, 6).forEach((file) => body.append('photos', file));
    try {
      await car.addPhotos(row.id, body);
    } catch (err) {
      toast(`آگهی ثبت شد ولی عکس‌ها بارگذاری نشد: ${err.message}`, 'danger');
      go('car-mine');
      await resolve();
      return undefined;
    }
  }

  toast(offer ? 'آگهی خودرو ثبت شد' : 'درخواست خرید ثبت شد');
  go('car-mine');
  await resolve();
  return undefined;
}

/** The filter form: names go straight into the route parameters. */
export function applyCarFilters(form) {
  const params = {};
  // Whole brands and single models, both possibly several — read out of the
  // picker the way the admin form reads it.
  const picked = brandPickValue(form);
  if (picked.brandIds.length) params.brandIds = picked.brandIds.join(',');
  if (picked.modelIds.length) params.carModelIds = picked.modelIds.join(',');
  for (const name of ['bodyType', 'yearFrom', 'yearTo', 'maxMileage', 'grades']) {
    const value = form.elements[name]?.value;
    if (value) params[name] = enDigits(value);
  }
  if (form.elements.warranty?.checked) params.warranty = '1';
  for (const name of ['priceFrom', 'priceTo']) {
    const value = form.elements[name]?.value;
    if (value) params[name] = enDigits(value);
  }
  // The tab and the order are not on this form, and applying a filter must
  // not quietly put the reader back on «همه، جدیدترین».
  const { params: current } = getState();
  if (current.kind) params.kind = current.kind;
  if (current.sort) params.sort = current.sort;
  go('car-search', params);
}

// ── my advertisements ───────────────────────────────────────────────────────

export function carMinePage() {
  const { data, params, user } = getState();
  const items = data.mine?.items || [];
  const reseller = Boolean(user?.isReseller);
  const scope = reseller ? params.scope || 'all' : 'own';

  const tabs = [
    ['', 'همه'],
    ['ACTIVE', 'فعال'],
    ['FULFILLED', 'فروخته شد'],
    ['SUSPENDED', 'تعلیق‌شده'],
  ];

  const scopes = [
    ['all', 'همه'],
    ['own', 'آگهی‌های خودم'],
    ['children', 'زیرشاخه‌ها'],
  ];

  const goParams = (patch) => {
    const q = { ...(params.status ? { status: params.status } : {}), ...(reseller ? { scope } : {}), ...patch };
    return Object.entries(q)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${v}`)
      .join('&');
  };

  return html`
  <div class="card">
    <div class="card-h">
      <h2>${reseller ? 'خودروهای مجموعه' : 'خودروهای من'} ${qtip('همه‌ی آگهی‌های خودرو و درخواست‌های خرید شما. «فروخته شد» آگهی را می‌بندد، «تمدید» یک هفته‌ی دیگر فعال نگهش می‌دارد.')}</h2>
      <div class="tabs">
        ${tabs.map(
          ([value, label]) => html`<button
            class="tab ${(params.status || '') === value ? 'on' : ''}"
            data-go="car-mine" data-go-params="${goParams({ status: value })}">${label}</button>`
        )}
      </div>
    </div>

    ${
      reseller
        ? html`<div class="scope-row">
            ${scopes.map(
              ([value, label]) => html`<button class="tab ${scope === value ? 'on' : ''}"
                data-go="car-mine" data-go-params="${goParams({ scope: value })}">${label}</button>`
            )}
          </div>`
        : ''
    }

    ${
      items.length
        ? html`<table>
            <thead>
              <tr>
                <th>خودرو</th>${reseller ? html`<th>زیرشاخه</th>` : ''}<th>نوع</th><th>قیمت</th>
                <th>وضعیت بدنه</th><th>وضعیت</th><th>مهلت</th><th>بازدید</th><th></th>
              </tr>
            </thead>
            <tbody>
              ${items.map(
                (c) => html`<tr>
                  <td>
                    <b>${c.carType}</b>
                    <div class="sub">
                      ${c.year ? `${faDigits(c.year)} · ` : ''}${c.kind === 'OFFER' ? `${mileage(c.mileageKm)} · ` : ''}${BODY_TYPE_FA[c.bodyType] || ''}
                    </div>
                    ${editedTag(c)}
                  </td>
                  ${
                    reseller
                      ? html`<td>${c.isOwn ? html`<span class="tag b">خودم</span>` : html`<span class="num">${c.agency?.code || '—'}</span>`}</td>`
                      : ''
                  }
                  <td>${CAR_KIND_LABEL[c.kind]}</td>
                  <td class="num">${c.carPriceToman ? money(c.carPriceToman) : '—'}</td>
                  <td>
                    ${
                      c.kind === 'OFFER'
                        ? html`<span class="tag ${GRADE_TONE[c.bodyGrade]}">${GRADE_FA[c.bodyGrade] || '—'}</span>`
                        : html`<span class="tag">${TOLERANCE_FA[c.paintTolerance] || '—'}</span>`
                    }
                  </td>
                  <td>${statusTag(c)}</td>
                  <td>${until(c.closesAt)}</td>
                  <td class="num">${faDigits(c.revealCount || 0)}</td>
                  <td class="row-actions">
                    <button class="btn sm" data-open-car="${c.id}">جزئیات</button>
                    ${
                      c.isOwn
                        ? html`
                          ${
                            c.status === 'ACTIVE'
                              ? html`<button class="btn sm" data-edit-car="${c.id}">ویرایش</button>`
                              : ''
                          }
                          <button class="btn sm" data-car-renew="${c.id}">تمدید</button>
                          ${
                            c.status === 'ACTIVE'
                              ? html`<button class="btn sm" data-car-fulfill="${c.id}">${c.kind === 'OFFER' ? 'فروخته شد' : 'بسته شد'}</button>`
                              : ''
                          }
                          <button class="btn sm danger" data-car-delete="${c.id}">حذف</button>`
                        : ''
                    }
                  </td>
                </tr>`
              )}
            </tbody>
          </table>`
        : emptyBox('آگهی خودرویی در این وضعیت ندارید.')
    }

    ${pager({
      page: data.mine?.page || 1,
      pages: data.mine?.pages || 1,
      go: 'car-mine',
      params: {
        ...(params.status ? { status: params.status } : {}),
        ...(reseller ? { scope } : {}),
      },
    })}
  </div>`;
}

function statusTag(c) {
  const dead = c.closesAt && new Date(c.closesAt) < Date.now();
  if (c.status === 'ACTIVE' && dead) return html`<span class="tag">مهلت تمام شده</span>`;
  if (c.status === 'ACTIVE') return html`<span class="tag g">فعال</span>`;
  if (c.status === 'FULFILLED') return html`<span class="tag b">فروخته شد</span>`;
  if (c.status === 'SUSPENDED') {
    return html`<span class="tag r" title="${c.suspendReason || ''}">تعلیق‌شده</span>`;
  }
  return html`<span class="tag">${c.status}</span>`;
}

/**
 * Editing — the price, the figures, the body and the text; never the car.
 *
 * The matrix rides inside the dialogue with its state in the DOM, exactly as
 * in the posting form. The server marks the row «ویرایش‌شده» and notifies
 * whoever paid to see it.
 */
export function carEditModal(id) {
  const { data } = getState();
  const c = (data.mine?.items || []).find((row) => row.id === id);
  if (!c) return;
  const offer = c.kind === 'OFFER';
  const colors = data.tree?.colors || [];

  openModal({
    type: 'form',
    title: `ویرایش — ${c.carType}`,
    wide: true,
    body: html`
      ${
        offer
          ? html`
            <div class="field">
              <label for="e-year">سال ساخت</label>
              <input class="in num" id="e-year" name="year" inputmode="numeric" maxlength="4"
                     value="${c.year || ''}" required>
            </div>
            <div class="field">
              <label for="e-mileage">کارکرد (کیلومتر)</label>
              <input class="in num" id="e-mileage" name="mileageKm" inputmode="numeric" maxlength="7"
                     value="${c.mileageKm ?? ''}" required>
            </div>
            <div class="field">
              <label for="e-color">رنگ بدنه</label>
              <select class="in" id="e-color" name="carColor" required>
                ${colors.map(
                  (color) =>
                    html`<option value="${color.name}" ${raw(color.name === c.carColor ? 'selected' : '')}>${color.name}</option>`
                )}
              </select>
            </div>
            <div class="field">
              <label for="e-warranty">گارانتی</label>
              <select class="in" id="e-warranty" name="warranty" required>
                ${c.warranty === null || c.warranty === undefined ? html`<option value="">انتخاب کنید</option>` : ''}
                <option value="true" ${raw(c.warranty === true ? 'selected' : '')}>فعال</option>
                <option value="false" ${raw(c.warranty === false ? 'selected' : '')}>غیرفعال</option>
              </select>
            </div>
            <div class="field">
              <label for="${moneyFieldId('carPriceToman')}">قیمت خودرو (تومان)</label>
              ${moneyInput('carPriceToman', { required: true, value: c.carPriceToman || '' })}
            </div>
            <div class="field wide">
              <label>وضعیت بدنه</label>
              ${bodyMatrix(c.bodyStatus || {}, c.bodyType)}
            </div>`
          : html`
            <div class="field">
              <label for="e-yearFrom">سال ساخت از</label>
              <input class="in num" id="e-yearFrom" name="yearFrom" inputmode="numeric" maxlength="4"
                     value="${c.yearFrom || ''}">
            </div>
            <div class="field">
              <label for="e-yearTo">سال ساخت تا</label>
              <input class="in num" id="e-yearTo" name="yearTo" inputmode="numeric" maxlength="4"
                     value="${c.yearTo || ''}">
            </div>
            <div class="field">
              <label for="e-maxMileage">حداکثر کارکرد</label>
              <input class="in num" id="e-maxMileage" name="maxMileageKm" inputmode="numeric" maxlength="7"
                     value="${c.maxMileageKm ?? ''}">
            </div>
            <div class="field">
              <label for="${moneyFieldId('carPriceToman')}">قیمت تا (تومان)</label>
              ${moneyInput('carPriceToman', { value: c.carPriceToman || '' })}
            </div>
            <div class="field">
              <label for="e-tolerance">بدنه‌ی قابل قبول</label>
              <select class="in" id="e-tolerance" name="paintTolerance">
                ${Object.entries(TOLERANCE_FA).map(
                  ([value, label]) =>
                    html`<option value="${value}" ${raw(value === c.paintTolerance ? 'selected' : '')}>${label}</option>`
                )}
              </select>
            </div>`
      }
      <div class="field wide">
        <label for="e-desc">توضیحات</label>
        <textarea class="in" id="e-desc" name="description" rows="3" maxlength="1000">${c.description || ''}</textarea>
      </div>
      ${
        // The photo shelf — only offers carry photos. Deleting acts at once
        // (each photo is its own row and file); new files ride with «ثبت
        // تغییرات» like the posting form. This is also the promised recovery
        // path when the upload failed right after posting.
        offer
          ? html`<div class="field wide">
              <label>عکس‌ها <span class="opt">(تا ۶ عکس)</span></label>
              <div class="car-photos" data-edit-photos>
                ${(c.photos || []).map(
                  (p) => html`<span class="car-photo-edit">
                    <img src="${p.url}" alt="عکس خودرو" loading="lazy">
                    <button type="button" class="btn sm danger" data-car-photo-del="${p.id}"
                            data-car-listing="${c.id}">حذف</button>
                  </span>`
                )}
              </div>
              <label class="btn sm tk-clip" title="JPG یا PNG یا WebP">
                ${icon('file', 15)} افزودن عکس
                <input type="file" name="photos" hidden
                       accept="image/jpeg,image/png,image/webp" multiple data-attach-input>
              </label>
              <span class="tk-attach-names hint" data-attach-names></span>
            </div>`
          : ''
      }
      <p style="color:var(--ink-3);font-size:12px">
        خودِ خودرو و نوع آگهی قابل تغییر نیست. آگهی نشان «ویرایش‌شده» می‌گیرد و به کسانی که
        قبلاً مشخصاتش را باز کرده‌اند اطلاع داده می‌شود.
      </p>`,
    confirmLabel: 'ثبت تغییرات',
    onSubmit: async (form) => {
      const entered = (name) => form.elements[name]?.value || '';
      const payload = { description: entered('description') };

      const numeric = offer
        ? ['year', 'mileageKm', 'carPriceToman']
        : ['yearFrom', 'yearTo', 'maxMileageKm', 'carPriceToman'];
      for (const name of numeric) {
        const value = entered(name);
        if (value !== '') payload[name] = Number(enDigits(value));
      }
      if (offer) {
        payload.carColor = entered('carColor');
        if (entered('warranty')) payload.warranty = entered('warranty') === 'true';
        payload.bodyStatus = bodyStatusOf(form);
      } else {
        payload.paintTolerance = entered('paintTolerance');
      }

      await car.update(id, payload);

      // New photos ride after the row is saved, same bargain as the posting
      // form: a failed upload reports itself instead of eating the edit.
      const files = form.elements.photos?.files;
      if (offer && files?.length) {
        const body = new FormData();
        [...files].slice(0, 6).forEach((file) => body.append('photos', file));
        try {
          await car.addPhotos(id, body);
        } catch (err) {
          toast(`تغییرات ثبت شد ولی عکس‌ها بارگذاری نشد: ${err.message}`, 'danger');
        }
      }

      toast('آگهی به‌روز شد');
      await resolve();
    },
  });
}

/**
 * Deleting one photo from the edit dialogue.
 *
 * No confirm dialogue on purpose: a second modal would tear down the edit
 * form and everything typed into it. The photo disappears at once and the
 * toast says so — and the store's copy is trimmed too, so reopening the
 * dialogue does not resurrect a thumbnail whose file is gone.
 */
export async function carPhotoDelete(el) {
  const photoId = el.dataset.carPhotoDel;
  try {
    await car.removePhoto(photoId);
  } catch (err) {
    return toast(err.message, 'danger');
  }
  el.closest('.car-photo-edit')?.remove();
  const { data } = getState();
  const item = (data.mine?.items || []).find((row) => row.id === el.dataset.carListing);
  if (item?.photos) {
    item.photos = item.photos.filter((p) => p.id !== photoId);
    item.photoCount = item.photos.length;
  }
  toast('عکس حذف شد');
}

export function carRenew(id) {
  openModal({
    type: 'confirm',
    title: 'تمدید آگهی',
    body: html`<p>آگهی از امروز <b>۷ روز دیگر</b> فعال می‌ماند.</p>`,
    confirmLabel: 'تمدید کن',
    onConfirm: async () => {
      await car.renew(id);
      toast('تمدید شد');
      await resolve();
    },
  });
}

export function carFulfill(id) {
  openModal({
    type: 'confirm',
    title: 'بستن آگهی',
    body: html`<p>آگهی از استعلام دیگران برداشته می‌شود و دیگر قابل ویرایش نیست.</p>`,
    confirmLabel: 'بسته شود',
    onConfirm: async () => {
      await car.fulfill(id);
      toast('آگهی بسته شد');
      await resolve();
    },
  });
}

export function carDelete(id) {
  openModal({
    type: 'confirm',
    tone: 'danger',
    title: 'حذف آگهی',
    body: html`<p>آگهی برای همیشه از فهرست شما و استعلام دیگران حذف می‌شود.</p>`,
    confirmLabel: 'حذف کن',
    onConfirm: async () => {
      await car.remove(id);
      toast('حذف شد');
      await resolve();
    },
  });
}
