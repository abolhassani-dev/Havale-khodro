import { html, raw } from '../../ui/html.js';
import { icon } from '../../ui/icons.js';
import { registration, catalog, havale } from '../../api/index.js';
import { getState } from '../../state/store.js';
import { money, faDigits, until, date, enDigits } from '../../ui/format.js';
import {
  emptyBox, toast, openModal, qtip, formErrorSlot, showFormError, clearFormError,
} from '../../ui/feedback.js';
import { pickSelect, syncPickSelect } from '../../ui/pickSelect.js';
import { jalaliDate } from '../../ui/dateInput.js';
import { moneyInput, moneyFieldId } from '../../ui/moneyInput.js';
import { editedTag } from './listings.js';
import { go, resolve } from '../../router.js';

/**
 * The ثبت‌نامی market, from the agency's side.
 *
 * What is advertised here is capacity in a factory scheme that has not been
 * registered yet — so there is no tracking code and no lottery result anywhere
 * on these pages. The rest reads like the حواله market on purpose: the same
 * hidden contact, the same allowance, the same three scopes on «my
 * advertisements». Somebody who has used one already knows how to use this.
 */

export const REG_KIND_LABEL = {
  OFFER: 'ظرفیت ثبت‌نام',
  REQUEST: 'درخواست ثبت‌نام',
};

/** How the factory decides who gets a slot. */
export const REG_METHODS = [
  ['LOTTERY', 'قرعه‌کشی'],
  ['TIME_PRIORITY', 'اولویت زمانی'],
];

/** How the car itself is paid for in the scheme. */
export const REG_SALE_TYPES = [
  ['PRESALE', 'پیش‌فروش'],
  ['CASH_SINGLE', 'نقدی تک‌مرحله‌ای'],
  ['CASH_STAGED', 'نقدی چند مرحله‌ای'],
  ['INSTALLMENT', 'اقساط'],
  ['PRODUCTION_PARTNERSHIP', 'مشارکت در تولید'],
];

const METHOD_LABEL = Object.fromEntries(REG_METHODS);
const SALE_LABEL = Object.fromEntries(REG_SALE_TYPES);

// ── loaders ─────────────────────────────────────────────────────────────────

export async function loadRegSearch(params) {
  // The catalogue and the allowance ride along with the results: the filters
  // need the first and the reveal button needs the second, and three sequential
  // requests would be three round trips for one page.
  const [list, tree, usage] = await Promise.all([
    registration.list({
      kind: params.kind,
      brandId: params.brandId,
      carModelId: params.carModelId,
      method: params.method,
      saleType: params.saleType,
      maxPremium: params.maxPremium,
      limit: 20,
    }),
    catalog.get(),
    havale.usage().catch(() => null),
  ]);
  return { list, tree, usage };
}

export async function loadRegForm() {
  return { tree: await catalog.get() };
}

export async function loadRegMine(params) {
  const reseller = Boolean(getState().user?.isReseller);
  const scope = reseller ? params.scope || 'all' : undefined;
  return { mine: await registration.mine({ status: params.status, scope, limit: 50 }) };
}

// ── the market ──────────────────────────────────────────────────────────────

export function regSearchPage() {
  const { data, params } = getState();
  const items = data.list?.items || [];
  const brands = data.tree?.brands || [];

  const kinds = [
    ['', 'همه'],
    ['OFFER', 'ظرفیت موجود'],
    ['REQUEST', 'درخواست‌ها'],
  ];

  return html`
  <div class="card">
    <div class="card-h">
      <h2>استعلام ثبت‌نامی ${qtip('ظرفیت‌های ثبت‌نامی که نمایندگی‌های دیگر اعلام کرده‌اند و درخواست‌هایی که ثبت کرده‌اند. شماره‌ی تماس آگهی‌دهنده پنهان است و با «نمایش مشخصات» باز می‌شود — که یک واحد از سقف روزانه‌ی مشترک شما مصرف می‌کند.')}</h2>
      <div class="kind-tabs">
        ${kinds.map(
          ([value, label]) => html`<button class="tab ${(params.kind || '') === value ? 'on' : ''}"
            data-go="reg-search" data-go-params="${value ? `kind=${value}` : ''}">${label}</button>`
        )}
      </div>
      <span class="tag">${faDigits(items.length)} آگهی</span>
    </div>

    <form class="filters" data-form="reg-filters">
      <div class="field">
        <label for="brandId">برند</label>
        ${pickSelect(
          'brandId',
          [
            { value: '', label: 'همه‌ی برندها' },
            ...brands.map((b) => ({
              value: b.id,
              label: `${b.name}${b.company ? ` — ${b.company.name}` : ''}`,
              search: b.slug || '',
            })),
          ],
          { value: params.brandId || '', searchLabel: 'نام برند — مثلاً پژو یا peugeot' }
        )}
      </div>

      ${filterSelect('method', 'روش ثبت‌نام', REG_METHODS, params.method)}
      ${filterSelect('saleType', 'نوع فروش', REG_SALE_TYPES, params.saleType)}

      <div class="field">
        <label for="maxPremium-in">سقف مبلغ امتیاز</label>
        ${moneyInput('maxPremium', { value: params.maxPremium || '', placeholder: 'تومان' })}
      </div>

      <div class="field" style="align-self:end;display:flex;gap:8px">
        <button class="btn primary" type="submit">اعمال</button>
        <button class="btn" type="button" data-go="reg-search">پاک کردن</button>
      </div>
    </form>

    ${items.length ? html`<div class="grid">${items.map(regCard)}</div>` : emptyBox('آگهی‌ای با این فیلترها پیدا نشد.')}
  </div>`;
}

function filterSelect(name, label, options, current) {
  return html`<div class="field">
    <label for="${name}">${label}</label>
    <select class="in" id="${name}" name="${name}">
      <option value="">همه</option>
      ${options.map(
        ([value, text]) => html`<option value="${value}" ${raw(current === value ? 'selected' : '')}>${text}</option>`
      )}
    </select>
  </div>`;
}

/**
 * One advertisement.
 *
 * The allocation method sits in the corner where the حواله card carries the
 * transfer form, because it is the first thing somebody wants to know: a
 * lottery is a maybe, a time-priority scheme is a race they can win today.
 */
function regCard(r) {
  const offer = r.kind === 'OFFER';
  return html`
  <article class="hcard ${r.isOwn ? 'own' : ''}">
    <header>
      <div>
        <span class="tag ${offer ? '' : 'c'}">${REG_KIND_LABEL[r.kind]}</span>
        ${editedTag(r)}
        <h3>${r.carType}</h3>
      </div>
      ${
        r.method
          ? html`<span class="solh ${r.method === 'LOTTERY' ? 'is-solh' : 'is-vek'}">
              <span class="solh-k">روش ثبت‌نام</span>
              <b>${METHOD_LABEL[r.method]}</b>
            </span>`
          : ''
      }
    </header>

    <dl>
      ${field('نوع فروش', SALE_LABEL[r.saleType] || '—')}
      ${field(offer ? 'تعداد ظرفیت' : 'تعداد', r.capacity ? faDigits(r.capacity) : '—')}
      ${field('قیمت خودرو', r.depositToman ? money(r.depositToman) : '—')}
      ${field(offer ? 'مبلغ امتیاز' : 'سقف مبلغ امتیاز', r.premiumToman ? money(r.premiumToman) : '—')}
      ${
        // A request is not asked for these, so it has nothing to print — two
        // rows of «—» in every card only make the ones that do carry a date
        // harder to spot.
        offer
          ? html`${field('مهلت ثبت‌نام', r.registerDeadline ? date(r.registerDeadline) : '—')}
            ${
              // Only when it is actually in hand. «موعد تحویل: —» on every card
              // somebody has not paid for would read as «this listing has no
              // delivery date», which is a different and untrue statement.
              r.deliveryEstimate ? field('موعد تحویل', r.deliveryEstimate) : ''
            }`
          : ''
      }
      ${
        // The scheme name is typed, so it is behind the reveal like the rest of
        // the typing. It reads like a title, which is exactly why it was the
        // field agencies signed their own name into.
        r.planName ? field('طرح', r.planName) : ''
      }
    </dl>

    ${r.conditions ? html`<p class="desc"><b>شرایط:</b> ${r.conditions}</p>` : ''}
    ${r.description ? html`<p class="desc">${r.description}</p>` : ''}
    ${
      // Four typed boxes on this market — the scheme, the delivery date, the
      // terms and the note — and none of them is on a card somebody has not
      // paid for. Said rather than hidden: «there is something here» is itself
      // a reason to open the contact.
      r.hasNotes && !r.contactRevealed
        ? html`<p class="desc locked">${icon('lock', 13)} نام طرح، موعد تحویل، شرایط و توضیحات با «نمایش مشخصات» باز می‌شوند.</p>`
        : ''
    }

    <footer>
      <div class="meta">
        ${
          r.agency
            ? html`<span>${r.agency.name || '—'}</span>
                ${r.agency.code ? html`<span class="num">${r.agency.code}</span>` : ''}
                ${r.agency.city ? html`<span>${r.agency.city}</span>` : ''}`
            : html`<span class="masked-id">نمایندگی محرمانه — با «نمایش مشخصات» باز می‌شود</span>`
        }
        <span class="tag">${until(r.closesAt)}</span>
      </div>
      ${regContact(r)}
    </footer>
  </article>`;
}

function field(label, value) {
  return html`<div><dt>${label}</dt><dd class="num">${value}</dd></div>`;
}

function regContact(r) {
  if (r.isOwn) {
    return html`<div class="contact own">
      <span>آگهی خودتان — ${faDigits(r.revealCount || 0)} بازدید</span>
      <button class="btn sm" data-go="reg-mine">آگهی‌های من</button>
    </div>`;
  }

  if (r.contact) {
    return html`<div class="contact shown">
      <div>
        <b>${r.contact.coordinatorName}</b>
        <a class="num phone" href="tel:${r.contact.coordinatorPhone}">${r.contact.coordinatorPhone}</a>
      </div>
      <button class="btn sm" data-report="${r.id}">گزارش تخلف</button>
    </div>`;
  }

  return html`<div class="contact hidden">
    <span>اطلاعات تماس مخفی است</span>
    <button class="btn primary sm" data-reg-reveal="${r.id}">نمایش مشخصات</button>
  </div>`;
}

/** Confirms first: the allowance is small, shared with حواله, and not refundable. */
export function confirmRegReveal(id) {
  const { data } = getState();
  const usage = data.usage;
  const left = usage ? Math.max(0, usage.dailyLimit - usage.dailyUsed) : null;

  openModal({
    type: 'confirm',
    title: 'نمایش اطلاعات تماس',
    body: html`
      <p>با نمایش این مشخصات، <b>یک واحد از سقف روزانه‌ی شما</b> مصرف می‌شود — همان سقفی
      که در بخش حواله هم خرج می‌کنید.</p>
      ${left !== null ? html`<p>باقی‌مانده‌ی امروز: <b class="num">${faDigits(left)}</b></p>` : ''}
      <p style="color:var(--ink-3);font-size:12px">باز کردن دوباره‌ی همین آگهی رایگان است.</p>`,
    confirmLabel: 'نمایش بده',
    onConfirm: async () => {
      try {
        await registration.reveal(id);
        toast('مشخصات تماس نمایش داده شد');
        await resolve();
      } catch (err) {
        // Running out of views is not a broken page: the message says it and
        // the results stay where they are.
        toast(err.message, 'danger');
      }
    },
  });
}

// ── the form ────────────────────────────────────────────────────────────────

/**
 * Announcing capacity asks for the scheme in full; asking for capacity asks for
 * the car and nothing else. That asymmetry is the product rule — an agency
 * looking to buy is flexible by nature, and making it invent a scheme name
 * would stop deals rather than describe them.
 */
export function regFormPage(kind) {
  const { data } = getState();
  const offer = kind === 'OFFER';
  const all = data.tree?.brands || [];
  // A capacity offer may only be posted under what this account holds; a
  // request may name any brand at all.
  const brands = offer ? all.filter((b) => b.canPost || b.postableModelIds?.length) : all;

  return html`
  <form class="card form" data-form="registration" data-kind="${kind}">
    <div class="card-h">
      <h2>
        ${offer ? 'اعلام ظرفیت ثبت‌نام' : 'ثبت درخواست ثبت‌نام'}
        ${qtip(
          offer
            ? 'ظرفیتی که در یک طرح کارخانه دارید و واگذار می‌کنید. شماره‌ی شما روی آگهی نوشته نمی‌شود؛ هر کس بخواهد ببیند از سقف خودش خرج می‌کند.'
            : 'خودرویی که برایش دنبال ظرفیت ثبت‌نام هستید. درخواست شما برای همه‌ی نمایندگی‌ها دیده می‌شود تا هر کس ظرفیت دارد با شما تماس بگیرد.'
        )}
      </h2>
    </div>

    <div style="padding:0 14px">${formErrorSlot()}</div>

    ${
      offer && !brands.length
        ? html`<div class="banner warn" style="margin:0 14px 12px">
            <span class="b-ico">⚠</span>
            <div class="b-txt">
              <b>هنوز برندی برای حساب شما تعیین نشده است</b>
              تا وقتی مشخص نشود کدام برندها را می‌توانید آگهی کنید، امکان اعلام ظرفیت ندارید.
              <b>ثبت درخواست ثبت‌نام محدودیتی ندارد.</b>
              از نمایندگی مرکزی یا پشتیبانی بخواهید برندهایتان را فعال کنند.
            </div>
          </div>`
        : ''
    }

    <div class="fields">
      <div class="field">
        <label for="brand">برند</label>
        ${pickSelect(
          'brand',
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
        <label for="planName">نام طرح ${raw(offer ? '' : '<span class="opt">(اختیاری)</span>')}</label>
        <input class="in" id="planName" name="planName" maxlength="120" ${raw(offer ? 'required' : '')}
               placeholder="مثلاً فروش فوق‌العاده مرداد ۱۴۰۵">
      </div>

      <div class="field">
        <label for="method">روش ثبت‌نام ${raw(offer ? '' : '<span class="opt">(اختیاری)</span>')}</label>
        <select class="in" id="method" name="method" ${raw(offer ? 'required' : '')}>
          <option value="">${offer ? 'انتخاب کنید' : 'فرقی نمی‌کند'}</option>
          ${REG_METHODS.map(([value, label]) => html`<option value="${value}">${label}</option>`)}
        </select>
        <div class="hint">قرعه‌کشی: اسامی قرعه‌کشی می‌شود · اولویت زمانی: هر کس زودتر ثبت کند.</div>
      </div>

      <div class="field">
        <label for="saleType">نوع فروش ${raw(offer ? '' : '<span class="opt">(اختیاری)</span>')}</label>
        <select class="in" id="saleType" name="saleType" ${raw(offer ? 'required' : '')}>
          <option value="">${offer ? 'انتخاب کنید' : 'فرقی نمی‌کند'}</option>
          ${REG_SALE_TYPES.map(([value, label]) => html`<option value="${value}">${label}</option>`)}
        </select>
      </div>

      ${numberField('capacity', offer ? 'تعداد ظرفیت' : 'تعداد', offer, '۴')}
      ${numberField('depositToman', 'قیمت خودرو (تومان)', offer, '', 'مبلغی که بابت خودِ خودرو به کارخانه پرداخت می‌شود.', true)}
      ${numberField(
        'premiumToman',
        offer ? 'مبلغ امتیاز (تومان)' : 'سقف مبلغ امتیاز (تومان)',
        offer,
        '',
        offer ? 'پولی که بابت واگذاری این ظرفیت می‌گیرید.' : 'تا چه مبلغی حاضرید بپردازید.',
        true
      )}

      ${
        // The deadline, the delivery date and the registrant's conditions are
        // facts about a factory scheme, and only the side holding capacity
        // knows them. On a request they were three empty boxes asking the
        // buyer to describe an offer they are still looking for — and a
        // deadline typed here was discarded outright, because a request's life
        // is a fixed window regardless (see closingDate on the server).
        offer
          ? html`
            <div class="field">
              <label for="registerDeadline-day">مهلت ثبت‌نام <span class="opt">(اختیاری)</span></label>
              ${jalaliDate('registerDeadline')}
              <div class="hint">اگر طرح مهلت ندارد خالی بگذارید — آگهی ۳۰ روزه می‌شود و قابل تمدید است.</div>
            </div>

            <div class="field">
              <label for="deliveryEstimate">موعد تحویل <span class="opt">(اختیاری)</span></label>
              <input class="in" id="deliveryEstimate" name="deliveryEstimate" maxlength="60"
                     placeholder="مثلاً اسفند ۱۴۰۵">
            </div>

            <div class="field wide">
              <label for="conditions">شرایط ثبت‌نام‌کننده <span class="opt">(اختیاری)</span></label>
              <input class="in" id="conditions" name="conditions" maxlength="300"
                     placeholder="مثلاً کد ملی بدون سابقه‌ی ثبت‌نام در ۴۸ ماه گذشته">
            </div>`
          : ''
      }

      <div class="field wide">
        <label for="description">توضیحات <span class="opt">(اختیاری)</span></label>
        <textarea class="in" id="description" name="description" rows="3" maxlength="1000"></textarea>
      </div>
    </div>

    <div class="form-foot">
      <div class="hint">
        شماره‌ی تماس شما روی آگهی نوشته نمی‌شود؛ هر کس بخواهد ببیند از سهمیه‌ی خودش خرج می‌کند.
      </div>
      <button class="btn primary" type="submit">ثبت آگهی</button>
    </div>
  </form>`;
}

function numberField(name, label, required, placeholder = '', hint = '', money = false) {
  return html`<div class="field">
    <label for="${money ? moneyFieldId(name) : name}">${label} ${raw(required ? '' : '<span class="opt">(اختیاری)</span>')}</label>
    ${
      // Prices group themselves by three as they are typed; a capacity of four
      // does not need it and «۱٬۴۰۵» for a model year would be wrong.
      money
        ? moneyInput(name, { required, placeholder })
        : html`<input class="in num" id="${name}" name="${name}" inputmode="numeric"
           placeholder="${placeholder}" ${raw(required ? 'required' : '')}>`
    }
    ${hint ? html`<div class="hint">${hint}</div>` : ''}
  </div>`;
}

/** The model list follows the brand, exactly as it does on the حواله form. */
export async function onRegBrandChange(form) {
  const { data } = getState();
  const brandId = form.brand.value;
  const brand = (data.tree?.brands || []).find((b) => b.id === brandId);
  const offer = form.dataset.kind === 'OFFER';

  const select = form.carModelId;
  select.innerHTML = '';
  select.disabled = true;

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = brand ? 'در حال بارگذاری…' : 'ابتدا برند را انتخاب کنید';
  select.appendChild(placeholder);
  syncPickSelect(select);
  if (!brand) return;

  let models = [];
  try {
    ({ models } = await catalog.brandModels(brandId));
  } catch {
    placeholder.textContent = 'بارگذاری مدل‌ها نشد — دوباره برند را انتخاب کنید';
    syncPickSelect(select);
    return;
  }

  // The reader may have switched brands while this was in flight.
  if (form.brand.value !== brandId) return;

  if (offer && !brand.canPost) {
    const mine = new Set(brand.postableModelIds || []);
    models = models.filter((m) => mine.has(m.id));
  }

  placeholder.textContent = 'انتخاب کنید';
  select.disabled = false;
  models.forEach((model) => {
    const option = document.createElement('option');
    option.value = model.id;
    option.textContent = model.name;
    select.appendChild(option);
  });
  syncPickSelect(select);
}

export async function submitRegistration(form) {
  const kind = form.dataset.kind;
  const payload = { kind, carModelId: form.carModelId.value };

  // Read through the form rather than by name: three of these fields only
  // exist on the capacity side, and `form.conditions.value` on a request form
  // is a TypeError, not an empty string.
  const entered = (name) => form.elements[name]?.value || '';

  // Text stays text; everything else is a number the Persian keyboard typed.
  const text = {
    planName: entered('planName'),
    method: entered('method'),
    saleType: entered('saleType'),
    deliveryEstimate: entered('deliveryEstimate'),
    conditions: entered('conditions'),
    description: entered('description'),
  };
  const numbers = {
    capacity: entered('capacity'),
    depositToman: entered('depositToman'),
    premiumToman: entered('premiumToman'),
  };

  Object.entries(text).forEach(([key, value]) => {
    if (value !== '') payload[key] = value;
  });
  Object.entries(numbers).forEach(([key, value]) => {
    if (value !== '') payload[key] = Number(enDigits(value));
  });

  // The Jalali picker hands back «2026-09-01» — the reader chose ۱۰ شهریور
  // ۱۴۰۵ and the conversion happened in the control. The API wants a moment, so
  // it is sent as the end of that day: a deadline of «today» is then still
  // ahead of now rather than already expired.
  if (entered('registerDeadline')) {
    payload.registerDeadline = new Date(`${entered('registerDeadline')}T23:59:00`).toISOString();
  }

  clearFormError(form);

  try {
    await registration.create(payload);
    toast('آگهی ثبت‌نامی ثبت شد');
    go('reg-mine');
    await resolve();
  } catch (err) {
    showFormError(form, err);
  }
}

// ── my advertisements ───────────────────────────────────────────────────────

export function regMinePage() {
  const { data, params, user } = getState();
  const items = data.mine?.items || [];
  const reseller = Boolean(user?.isReseller);
  const scope = reseller ? params.scope || 'all' : 'own';

  const tabs = [
    ['', 'همه'],
    ['ACTIVE', 'فعال'],
    ['FULFILLED', 'واگذارشده'],
    ['EXPIRED', 'منقضی'],
  ];

  const scopes = [
    ['all', 'همه'],
    ['own', 'آگهی‌های خودم'],
    ['children', 'زیرشاخه‌ها'],
  ];

  const goParams = (patch) => {
    const q = {
      ...(params.status ? { status: params.status } : {}),
      ...(reseller ? { scope } : {}),
      ...patch,
    };
    return Object.entries(q)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${v}`)
      .join('&');
  };

  return html`
  <div class="card">
    <div class="card-h">
      <h2>
        ${reseller ? 'ثبت‌نامی‌های مجموعه' : 'ثبت‌نامی‌های من'}
        ${qtip(
          reseller
            ? 'آگهی‌های ثبت‌نامی خودتان و زیرنمایندگی‌هایتان. تمدید و واگذاری فقط روی آگهی‌های خودتان ممکن است — آگهی زیرشاخه مال خود اوست.'
            : 'همه‌ی آگهی‌های ثبت‌نامی شما. «واگذار شد» آگهی را می‌بندد و «تمدید» مهلتش را تازه می‌کند.'
        )}
      </h2>
      <div class="tabs">
        ${tabs.map(
          ([value, label]) => html`<button class="tab ${(params.status || '') === value ? 'on' : ''}"
            data-go="reg-mine" data-go-params="${goParams({ status: value })}">${label}</button>`
        )}
      </div>
    </div>

    ${
      reseller
        ? html`<div class="scope-row">
            ${scopes.map(
              ([value, label]) => html`<button class="tab ${scope === value ? 'on' : ''}"
                data-go="reg-mine" data-go-params="${goParams({ scope: value })}">${label}</button>`
            )}
          </div>`
        : ''
    }

    ${
      items.length
        ? html`<table>
            <thead>
              <tr>
                <th>خودرو</th>${reseller ? html`<th>زیرشاخه</th>` : ''}
                <th>طرح</th><th>روش / نوع فروش</th><th>ظرفیت</th>
                <th>مبلغ امتیاز</th><th>مهلت</th><th>بازدید</th><th></th>
              </tr>
            </thead>
            <tbody>${items.map((r) => mineRow(r, reseller))}</tbody>
          </table>`
        : emptyBox('هنوز آگهی ثبت‌نامی ندارید.')
    }
  </div>`;
}

function mineRow(r, reseller) {
  const closed = r.status !== 'ACTIVE';
  return html`<tr class="${closed ? 'dim' : ''}">
    <td>
      <b>${r.carType}</b>
      <div class="sub">${REG_KIND_LABEL[r.kind]}</div>
      ${editedTag(r)}
    </td>
    ${
      reseller
        ? html`<td>
            ${r.isOwn
              ? html`<span class="sub">آگهی خودم</span>`
              : html`<span class="tag n num">${r.agency?.code || '—'}</span>`}
          </td>`
        : ''
    }
    <td>${r.planName || '—'}</td>
    <td>${[METHOD_LABEL[r.method], SALE_LABEL[r.saleType]].filter(Boolean).join(' · ') || '—'}</td>
    <td class="num">${r.capacity ? faDigits(r.capacity) : '—'}</td>
    <td class="num">${r.premiumToman ? money(r.premiumToman) : '—'}</td>
    <td>${statusTag(r)}</td>
    <td class="num">${faDigits(r.revealCount || 0)}</td>
    <td style="text-align:left">
      ${
        // Only on your own: a sub-agency's advertisement is its own to manage,
        // and the server answers 404 to anybody else who tries.
        r.isOwn
          ? html`
            ${
              // Only while it is still on the market: a fulfilled or suspended
              // advertisement is a record of what happened, not an offer.
              r.status === 'ACTIVE'
                ? html`<button class="btn sm" data-reg-edit="${r.id}">ویرایش</button>`
                : ''
            }
            <button class="btn sm" data-reg-renew="${r.id}" data-reg-kind="${r.kind}">تمدید</button>
            ${r.status === 'ACTIVE' ? html`<button class="btn sm" data-reg-fulfill="${r.id}">واگذار شد</button>` : ''}
            <button class="btn sm danger" data-reg-delete="${r.id}">حذف</button>`
          : html`<span class="sub">آگهی زیرشاخه</span>`
      }
    </td>
  </tr>`;
}

function statusTag(r) {
  if (r.status === 'FULFILLED') return html`<span class="tag g">واگذار شد</span>`;
  if (r.status === 'SUSPENDED') return html`<span class="tag r">تعلیق‌شده</span>`;
  if (r.status !== 'ACTIVE') return html`<span class="tag n">منقضی</span>`;
  return html`<span class="tag ${until(r.closesAt).includes('روز') ? 'w' : 'n'}">${until(r.closesAt)}</span>`;
}

/**
 * Editing a ثبت‌نامی advertisement — the same bargain as in the حواله market.
 *
 * The car and the kind are not on the form: they are what the advertisement is,
 * and a row that three hundred agencies read as one car must not become another
 * while keeping its age and its view count. Everything else — the scheme, the
 * terms, the prices, the deadline — is a fact of the deal that genuinely moves,
 * and a market where correcting one means starting again fills up with stale
 * prices.
 *
 * Nothing about the edit is hidden: the card wears «ویرایش‌شده», the change is
 * written into the activity log field by field, and anybody who spent an
 * allowance on this advertisement's contact is told it changed after they saw it.
 */
export function regEditModal(id) {
  const { data } = getState();
  const item = (data.mine?.items || []).find((r) => r.id === id);
  if (!item) return;

  const offer = item.kind === 'OFFER';

  openModal({
    type: 'form',
    title: `ویرایش آگهی #${faDigits(item.serial)}`,
    body: html`
      <div class="drow"><span>خودرو</span><b>${item.carType}</b></div>
      <p style="color:var(--ink-3);font-size:12px;margin:6px 0 10px">
        خودرو و نوع آگهی قابل تغییر نیستند. این ویرایش روی آگهی نشان داده می‌شود و
        به هر کسی که مشخصات شما را دیده اطلاع می‌رسد.
      </p>

      <div class="field">
        <label for="e-plan">نام طرح</label>
        <input class="in" id="e-plan" name="planName" maxlength="120"
               value="${item.planName || ''}">
      </div>

      <div class="field">
        <label for="e-method">روش ثبت‌نام</label>
        <select class="in" id="e-method" name="method">
          <option value="">انتخاب کنید</option>
          ${REG_METHODS.map(
            ([value, label]) => html`<option value="${value}" ${raw(item.method === value ? 'selected' : '')}>${label}</option>`
          )}
        </select>
      </div>

      <div class="field">
        <label for="e-sale">نوع فروش</label>
        <select class="in" id="e-sale" name="saleType">
          <option value="">انتخاب کنید</option>
          ${REG_SALE_TYPES.map(
            ([value, label]) => html`<option value="${value}" ${raw(item.saleType === value ? 'selected' : '')}>${label}</option>`
          )}
        </select>
      </div>

      <div class="field">
        <label for="e-capacity">${offer ? 'تعداد ظرفیت' : 'تعداد'}</label>
        <input class="in num" id="e-capacity" name="capacity" inputmode="numeric"
               value="${item.capacity || ''}">
      </div>

      <div class="field">
        <label for="${moneyFieldId('depositToman')}">قیمت خودرو (تومان)</label>
        ${moneyInput('depositToman', { value: item.depositToman ?? '' })}
      </div>
      <div class="field">
        <label for="${moneyFieldId('premiumToman')}">${offer ? 'مبلغ امتیاز (تومان)' : 'سقف مبلغ امتیاز (تومان)'}</label>
        ${moneyInput('premiumToman', { value: item.premiumToman ?? '' })}
      </div>

      ${
        // Only a capacity holder knows the scheme's dates — a request has no
        // scheme behind it, so these two would be questions with no answer.
        offer
          ? html`<div class="field">
              <label for="ed-day">مهلت ثبت‌نام</label>
              ${jalaliDate('registerDeadline', { value: item.registerDeadline || '', labelId: 'ed-day' })}
            </div>
            <div class="field">
              <label for="e-delivery">موعد تحویل</label>
              <input class="in" id="e-delivery" name="deliveryEstimate" maxlength="60"
                     value="${item.deliveryEstimate || ''}">
            </div>`
          : ''
      }

      <div class="field">
        <label for="e-desc">توضیحات</label>
        <textarea class="in" id="e-desc" name="description" rows="3" maxlength="1000">${item.description || ''}</textarea>
      </div>`,
    confirmLabel: 'ثبت ویرایش',
    onSubmit: async (form) => {
      // Only what moved: writing every field on every edit would fill the
      // activity log — which reads «from x to y» — with changes that were not.
      const payload = {};
      const put = (name, value, before) => {
        if (value !== before) payload[name] = value;
      };
      const text = (name) => form[name]?.value.trim() ?? '';

      put('planName', text('planName'), item.planName || '');
      put('method', form.method.value || undefined, item.method ?? undefined);
      put('saleType', form.saleType.value || undefined, item.saleType ?? undefined);

      const capacity = text('capacity');
      if (capacity) put('capacity', Number(enDigits(capacity)), item.capacity ?? null);

      for (const name of ['depositToman', 'premiumToman']) {
        const value = form[name].value.trim();
        put(name, value === '' ? null : Number(value), item[name] ?? null);
      }

      if (offer) {
        const deadline = text('registerDeadline');
        const before = item.registerDeadline ? String(item.registerDeadline).slice(0, 10) : '';
        put('registerDeadline', deadline || null, before || null);
        put('deliveryEstimate', text('deliveryEstimate'), item.deliveryEstimate || '');
      }

      put('description', text('description'), item.description || '');

      if (!Object.keys(payload).length) {
        toast('چیزی تغییر نکرده بود');
        return;
      }

      await registration.update(id, payload);
      toast('آگهی ویرایش شد');
      await resolve();
    },
  });
}

export function regRenew(id, kind) {
  // A request has no scheme behind it and therefore no deadline to move: the
  // server gives it a fixed window whatever is sent, so asking for a date here
  // would be a question whose answer is thrown away.
  if (kind === 'REQUEST') {
    openModal({
      type: 'confirm',
      title: 'تمدید درخواست ثبت‌نام',
      body: html`<p>درخواست شما دوباره ۷ روز روی سامانه می‌ماند.</p>`,
      confirmLabel: 'تمدید کن',
      onConfirm: async () => {
        try {
          await registration.renew(id, {});
          toast('آگهی تمدید شد');
          await resolve();
        } catch (err) {
          toast(err.message, 'danger');
        }
      },
    });
    return;
  }

  openModal({
    type: 'form',
    title: 'تمدید آگهی ثبت‌نامی',
    body: html`
      <div class="field">
        <label for="rd-day">مهلت تازه‌ی ثبت‌نام <span class="opt">(اختیاری)</span></label>
        ${jalaliDate('registerDeadline', { labelId: 'rd-day' })}
        <div class="hint">
          خالی بگذارید تا مهلت فعلی حفظ شود. اگر طرح مهلت ندارد، آگهی ۳۰ روز دیگر زنده می‌ماند.
        </div>
      </div>`,
    confirmLabel: 'تمدید کن',
    onSubmit: async (form) => {
      const value = form.registerDeadline.value;
      await registration.renew(
        id,
        value ? { registerDeadline: new Date(`${value}T23:59:00`).toISOString() } : {}
      );
      toast('آگهی تمدید شد');
      await resolve();
    },
  });
}

export function regFulfill(id) {
  openModal({
    type: 'confirm',
    title: 'واگذار شد',
    body: html`<p>آگهی بسته می‌شود و از استعلام دیگران بیرون می‌رود. سابقه‌اش برای شما می‌ماند.</p>`,
    confirmLabel: 'بله، واگذار شد',
    onConfirm: async () => {
      try {
        await registration.fulfill(id);
        toast('آگهی بسته شد');
        await resolve();
      } catch (err) {
        toast(err.message, 'danger');
      }
    },
  });
}

export function regDelete(id) {
  openModal({
    type: 'confirm',
    tone: 'danger',
    title: 'حذف آگهی',
    body: html`<p>آگهی از استعلام دیگران برداشته می‌شود. این کار برگشت‌پذیر نیست.</p>`,
    confirmLabel: 'حذف کن',
    onConfirm: async () => {
      try {
        await registration.remove(id);
        toast('آگهی حذف شد');
        await resolve();
      } catch (err) {
        toast(err.message, 'danger');
      }
    },
  });
}
