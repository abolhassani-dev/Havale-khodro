import { html, raw } from '../../ui/html.js';
import { havale, catalog } from '../../api/index.js';
import { getState, setState } from '../../state/store.js';
import {
  money, faDigits, until, date, KIND_LABEL, SOLH_LABEL, HAVALE_STATUS_LABEL,
  PAYMENT_TYPES, PAYMENT_TYPE_LABEL,
} from '../../ui/format.js';
import { emptyBox, toast, openModal, qtip, formErrorSlot, showFormError, clearFormError } from '../../ui/feedback.js';
import { enDigits } from '../../ui/format.js';
import { LIMITS } from '../../constants.js';
import { go, resolve } from '../../router.js';

/** Posting a listing or a purchase request, and managing the ones you have. */

export async function loadCatalogForm() {
  return { tree: await catalog.get() };
}

export async function loadMine(params) {
  return { mine: await havale.mine({ status: params.status, limit: 50 }) };
}

/**
 * The form.
 *
 * A purchase request asks for two fields; a sale listing asks for nine. That is
 * the product rule, not a shortcut — a buyer who will take any colour should not
 * have to invent one (blueprint 5.2).
 */
export function havaleFormPage(kind) {
  const { data } = getState();
  const tree = data.tree;
  const offer = kind === 'OFFER';

  const brands = (tree?.companies || []).flatMap((c) =>
    c.brands.map((b) => ({ ...b, company: c.name }))
  );

  return html`
  <form class="card form" data-form="havale" data-kind="${kind}">
    <div class="card-h">
      <h2>${offer ? 'ثبت حواله فروش' : 'ثبت درخواست خرید حواله'} ${qtip(offer ? 'مشخصات حواله‌ای که می‌خواهید واگذار کنید. بعد از ثبت، آگهی برای همه‌ی نمایندگی‌ها نمایش داده می‌شود ولی شماره تماس شما فقط برای کسی باز می‌شود که روی آگهی «نمایش مشخصات» بزند.' : 'مشخصات خودرویی که دنبالش هستید. درخواست شما برای همه‌ی نمایندگی‌ها نمایش داده می‌شود تا هر کس چنین حواله‌ای دارد با شما تماس بگیرد.')}</h2>
    </div>

    <div style="padding:0 14px">${formErrorSlot()}</div>

    <div class="fields">
      <div class="field">
        <label for="brand">برند</label>
        <select class="in" id="brand" name="brand" required>
          <option value="">انتخاب کنید</option>
          ${brands.map((b) => html`<option value="${b.id}">${b.company} — ${b.name}</option>`)}
        </select>
      </div>

      <div class="field">
        <label for="carModelId">مدل خودرو</label>
        <select class="in" id="carModelId" name="carModelId" required disabled>
          <option value="">ابتدا برند را انتخاب کنید</option>
        </select>
        <div class="hint">اگر مدلی در فهرست نیست، از پشتیبانی بخواهید اضافه شود.</div>
      </div>

      <div class="field">
        <label for="solh">امکان صلح</label>
        <select class="in" id="solh" name="solh" required>
          <option value="SOLH">صلح</option>
          <option value="VEKALATI">وکالتی</option>
        </select>
      </div>

      <div class="field">
        <label for="carColor">رنگ ${raw(offer ? '' : '<span class="opt">(اختیاری)</span>')}</label>
        <select class="in" id="carColor" name="carColor" ${raw(offer ? 'required' : '')}>
          <option value="">${offer ? 'انتخاب کنید' : 'هر رنگ'}</option>
          ${(tree?.colors || []).map((c) => html`<option value="${c.name}">${c.name}</option>`)}
        </select>
      </div>

      ${numberField('model', 'مدل (سال)', offer, '۱۴۰۵')}
      ${numberField('carPriceToman', 'قیمت خودرو (تومان)', offer)}
      ${numberField('amountToman', 'مبلغ حواله (تومان)', offer)}
      ${numberField('paidAmountToman', 'مبلغ واریز شده (تومان)', offer)}

      <div class="field">
        <label for="paymentType">
          نحوه پرداخت ${raw(offer ? '' : '<span class="opt">(اختیاری)</span>')}
        </label>
        <select class="in" id="paymentType" name="paymentType" ${raw(offer ? 'required' : '')}>
          <option value="">${offer ? 'انتخاب کنید' : 'فرقی نمی‌کند'}</option>
          ${PAYMENT_TYPES.map(([value, label]) => html`<option value="${value}">${label}</option>`)}
        </select>
      </div>

      ${numberField('deliveryDays', 'زمان تحویل (روز)', offer)}

      ${
        // The deposit window, on both kinds. It used to appear only on a sale,
        // and a purchase request had a read-only note in its place — but the
        // field list says it is available on a request too, the API accepts it,
        // and a buyer stating "I can deposit within ten days" is exactly the
        // thing a seller reads a request to find out. Leaving it off meant a
        // request could never carry it, and nothing said why.
        //
        // It is not the listing's lifetime here, which is why the two are now
        // explained separately: a request always closes after seven days
        // whatever this says.
        offer
          ? html`<div class="field">
              <label for="depositDays">مدت زمان واریز (روز)</label>
              <input class="in num" id="depositDays" name="depositDays" inputmode="numeric"
                     min="${LIMITS.depositDaysMin}" max="${LIMITS.depositDaysMax}" required>
              <div class="hint">
                عمر آگهی هم همین است: بعد از ${faDigits(LIMITS.depositDaysMax)} روز حداکثر،
                آگهی بسته می‌شود و با یک کلیک قابل تمدید است.
              </div>
            </div>`
          : html`<div class="field">
              <label for="depositDays">مدت زمان واریز (روز) <span class="opt">(اختیاری)</span></label>
              <input class="in num" id="depositDays" name="depositDays" inputmode="numeric"
                     min="${LIMITS.depositDaysMin}" max="${LIMITS.depositDaysMax}">
              <div class="hint">
                مهلتی که برای واریز در اختیار دارید. عمر خودِ آگهی به این بستگی ندارد —
                درخواست خرید همیشه ۷ روز فعال می‌ماند و قابل تمدید است.
              </div>
            </div>`
      }

      <div class="field wide">
        <label for="description">توضیحات <span class="opt">(اختیاری)</span></label>
        <textarea class="in" id="description" name="description" rows="3" maxlength="1000"></textarea>
      </div>
    </div>

    <div class="form-foot">
      <div class="hint">
        کد نمایندگی، شهر و اطلاعات تماس خودکار از پروفایل شما خوانده می‌شود و اینجا وارد نمی‌شود.
      </div>
      <button class="btn primary" type="submit">ثبت</button>
    </div>
  </form>`;
}

function numberField(name, label, required, placeholder = '') {
  return html`<div class="field">
    <label for="${name}">${label} ${raw(required ? '' : '<span class="opt">(اختیاری)</span>')}</label>
    <input class="in num" id="${name}" name="${name}" inputmode="numeric"
           placeholder="${placeholder}" ${raw(required ? 'required' : '')}>
  </div>`;
}

/** Repopulates the model list when the brand changes. */
export function onBrandChange(form) {
  const { data } = getState();
  const brandId = form.brand.value;
  const brand = (data.tree?.companies || []).flatMap((c) => c.brands).find((b) => b.id === brandId);

  const select = form.carModelId;
  select.innerHTML = '';
  select.disabled = !brand;

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = brand ? 'انتخاب کنید' : 'ابتدا برند را انتخاب کنید';
  select.appendChild(placeholder);

  (brand?.models || []).forEach((model) => {
    const option = document.createElement('option');
    option.value = model.id;
    // textContent, not innerHTML: a model name is operator-entered text and has
    // no business being parsed as markup.
    option.textContent = model.name;
    select.appendChild(option);
  });
}

export async function submitHavale(form) {
  const kind = form.dataset.kind;
  const payload = { kind, carModelId: form.carModelId.value, solh: form.solh.value };

  const optional = {
    carColor: form.carColor.value,
    model: form.model.value,
    carPriceToman: form.carPriceToman.value,
    amountToman: form.amountToman.value,
    paidAmountToman: form.paidAmountToman.value,
    paymentType: form.paymentType.value,
    deliveryDays: form.deliveryDays.value,
    depositDays: form.depositDays ? form.depositDays.value : '',
    description: form.description.value,
  };

  // Which fields the API wants as text rather than as a number.
  //
  // `model` is the model *year* — «۱۴۰۵» — and the schema types it as a string,
  // because it is a label rather than a quantity nobody will ever do arithmetic
  // on. This list used to hold only carColor and description, so the year was
  // sent as the number 1405 and the server answered «"model" must be a string»
  // for every sale listing submitted from this form. The backend tests missed
  // it because they build their payload directly and send '1405' as text — the
  // request the browser actually makes was never the request under test.
  //
  // `paymentType` is here for the same reason and would fail louder: it is an
  // enum, so `Number(enDigits('CASH'))` is NaN and every sale listing would be
  // refused.
  const AS_TEXT = new Set(['carColor', 'description', 'paymentType']);

  Object.entries(optional).forEach(([key, value]) => {
    if (value === '' || value === undefined) return;

    // Text is passed through untouched — running enDigits over a description
    // would rewrite the digits inside somebody's sentence.
    if (AS_TEXT.has(key)) {
      payload[key] = value;
      return;
    }
    // Persian digits are what an Iranian keyboard produces, and the API takes
    // Latin ones. Converting here rather than refusing is the difference
    // between a form that works and one that blames the user for their
    // keyboard. The year stays text after the conversion; everything else
    // becomes a number.
    payload[key] = key === 'model' ? enDigits(value) : Number(enDigits(value));
  });

  clearFormError(form);

  try {
    await havale.create(payload);
    toast('حواله ثبت شد');
    go('mine');
    await resolve();
  } catch (err) {
    showFormError(form, err);
  }
}

export function minePage() {
  const { data, params } = getState();
  const items = data.mine?.items || [];

  const tabs = [
    ['', 'همه'],
    ['ACTIVE', 'فعال'],
    ['FULFILLED', 'فروخته شد'],
    ['SUSPENDED', 'تعلیق‌شده'],
  ];

  return html`
  <div class="card">
    <div class="card-h">
      <h2>حواله‌های من ${qtip('همه‌ی آگهی‌های خودتان. «فروخته شد» آگهی را می‌بندد، «تمدید» مهلت را هفت روز دیگر تمدید می‌کند و «حذف» آن را کامل برمی‌دارد. آگهی بعد از پایان مهلت خودبه‌خود از استعلام دیگران حذف می‌شود.')}</h2>
      <div class="tabs">
        ${tabs.map(
          ([value, label]) => html`<button
            class="tab ${(params.status || '') === value ? 'on' : ''}"
            data-go="mine" data-go-params="${value ? `status=${value}` : ''}">${label}</button>`
        )}
      </div>
    </div>

    ${
      items.length
        ? html`<table>
            <thead>
              <tr>
                <th>خودرو</th><th>نوع</th><th>مبلغ</th><th>وضعیت</th>
                <th>مهلت</th><th>بازدید</th><th></th>
              </tr>
            </thead>
            <tbody>
              ${items.map(
                (h) => html`<tr>
                  <td>
                    <b>${h.carType}</b>
                    <div class="sub">${h.carColor || 'هر رنگ'} · ${SOLH_LABEL[h.solh]}</div>
                  </td>
                  <td>${KIND_LABEL[h.kind]}</td>
                  <td class="num">${money(h.amountToman)}</td>
                  <td>${statusTag(h)}</td>
                  <td>${until(h.closesAt)}</td>
                  <td class="num">${faDigits(h.revealCount || 0)}</td>
                  <td class="row-actions">
                    <!-- The detail view had a handler and a dispatch entry but
                         nothing that emitted the attribute, so it could not be
                         opened from anywhere. The table shows one of the three
                         money figures; this is where the other two, the payment
                         terms and the deposit window live. -->
                    <button class="btn sm" data-open-havale="${h.id}">جزئیات</button>
                    <button class="btn sm" data-renew="${h.id}">تمدید</button>
                    ${
                      h.status === 'ACTIVE'
                        ? html`<button class="btn sm" data-fulfill="${h.id}">فروخته شد</button>`
                        : ''
                    }
                    <button class="btn sm danger" data-delete-havale="${h.id}">حذف</button>
                  </td>
                </tr>`
              )}
            </tbody>
          </table>`
        : emptyBox('حواله‌ای در این وضعیت ندارید.')
    }
  </div>`;
}

function statusTag(h) {
  const dead = h.closesAt && new Date(h.closesAt) < Date.now();
  if (h.status === 'ACTIVE' && dead) return html`<span class="tag">مهلت تمام شده</span>`;
  if (h.status === 'ACTIVE') return html`<span class="tag g">فعال</span>`;
  if (h.status === 'SUSPENDED') {
    return html`<span class="tag r" title="${h.suspendReason || ''}">تعلیق‌شده</span>`;
  }
  return html`<span class="tag">${HAVALE_STATUS_LABEL[h.status] || h.status}</span>`;
}

/**
 * Renewal asks for the delivery time again rather than carrying it over.
 *
 * It was quoted in days from the original posting date, so after two renewals
 * the number on screen would be describing a date in the past.
 */
export function renewModal(id) {
  const { data } = getState();
  const item = (data.mine?.items || []).find((h) => h.id === id);

  openModal({
    type: 'form',
    title: 'تمدید آگهی',
    body: html`
      <p style="color:var(--ink-3);font-size:12px">
        زمان تحویل دوباره پرسیده می‌شود چون از تاریخ ثبت شمرده می‌شد و بعد از تمدید دیگر درست نبود.
      </p>
      <div class="field">
        <label for="m-delivery">زمان تحویل (روز)</label>
        <input class="in num" id="m-delivery" name="deliveryDays" inputmode="numeric"
               value="${item?.deliveryDays || ''}" required>
      </div>
      <div class="field">
        <label for="m-deposit">مدت زمان واریز (روز)</label>
        <input class="in num" id="m-deposit" name="depositDays" inputmode="numeric"
               value="${item?.depositDays || ''}" min="${LIMITS.depositDaysMin}"
               max="${LIMITS.depositDaysMax}" required>
      </div>`,
    confirmLabel: 'تمدید کن',
    onSubmit: async (form) => {
      await havale.renew(id, {
        deliveryDays: Number(enDigits(form.deliveryDays.value)),
        depositDays: Number(enDigits(form.depositDays.value)),
      });
      toast('آگهی تمدید شد');
      await resolve();
    },
  });
}

export function confirmFulfill(id) {
  openModal({
    type: 'confirm',
    title: 'علامت «فروخته شد»',
    body: html`<p>این حواله از لیست عمومی خارج می‌شود. سابقه‌اش در پنل مدیریت باقی می‌ماند.</p>`,
    confirmLabel: 'فروخته شد',
    onConfirm: async () => {
      await havale.fulfill(id);
      toast('حواله «فروخته شد» علامت خورد');
      await resolve();
    },
  });
}

export function confirmDelete(id) {
  openModal({
    type: 'confirm',
    title: 'حذف حواله',
    tone: 'danger',
    body: html`
      <p>حواله از دید همه‌ی نمایندگی‌ها ناپدید می‌شود.</p>
      <p style="color:var(--ink-3);font-size:12px">
        سابقه‌ی بازدیدها و گزارش‌های تخلف مربوط به آن در پنل مدیریت باقی می‌ماند و تا ۳۰ روز
        همچنان قابل گزارش است.
      </p>`,
    confirmLabel: 'حذف کن',
    onConfirm: async () => {
      await havale.remove(id);
      toast('حواله حذف شد');
      await resolve();
    },
  });
}

export function havaleDetailModal(id) {
  const { data } = getState();
  const item =
    (data.mine?.items || []).find((h) => h.id === id) ||
    (data.list?.items || []).find((h) => h.id === id);
  if (!item) return;

  openModal({
    type: 'info',
    title: `${item.carType} — ${KIND_LABEL[item.kind]}`,
    body: html`
      <div class="drow"><span>قیمت خودرو</span><b>${money(item.carPriceToman)}</b></div>
      <div class="drow"><span>مبلغ حواله</span><b>${money(item.amountToman)}</b></div>
      <div class="drow"><span>مبلغ واریز شده</span><b>${money(item.paidAmountToman)}</b></div>
      <div class="drow"><span>نحوه پرداخت</span><b>${PAYMENT_TYPE_LABEL[item.paymentType] || '—'}</b></div>
      <div class="drow"><span>مدت واریز</span><b>${item.depositDays ? `${faDigits(item.depositDays)} روز` : '—'}</b></div>
      <div class="drow"><span>زمان تحویل</span><b>${item.deliveryDays ? `${faDigits(item.deliveryDays)} روز` : '—'}</b></div>
      <div class="drow"><span>رنگ</span><b>${item.carColor || 'هر رنگ'}</b></div>
      <div class="drow"><span>مدل</span><b>${item.model || '—'}</b></div>
      <div class="drow"><span>واگذاری</span><b>${SOLH_LABEL[item.solh]}</b></div>
      <div class="drow"><span>شرکت</span><b>${item.supplierCompany || '—'}</b></div>
      <div class="drow"><span>ثبت</span><b>${date(item.createdAt)}</b></div>
      <div class="drow"><span>مهلت</span><b>${until(item.closesAt)}</b></div>
      <div class="drow"><span>بازدید مشخصات</span><b>${faDigits(item.revealCount || 0)}</b></div>
      ${
        item.isOwn
          ? html`<p style="color:var(--ink-3);font-size:12px;margin-top:8px">
              فقط تعداد بازدید را می‌بینید، نه اینکه چه کسی دیده است.
            </p>`
          : ''
      }
      ${item.description ? html`<p style="margin-top:8px">${item.description}</p>` : ''}`,
  });
}
