import { html, raw } from '../../ui/html.js';
import { havale, catalog } from '../../api/index.js';
import { getState, setState } from '../../state/store.js';
import { num, money, faDigits, until, KIND_LABEL, SOLH_LABEL } from '../../ui/format.js';
import { emptyBox, toast, openModal } from '../../ui/feedback.js';
import { usageChip } from '../../ui/shell.js';
import { resolve } from '../../router.js';

/**
 * Browsing listings, and the button that opens a seller's contact details.
 *
 * The masking is not implemented here, and that is the point: the server never
 * sends a number this viewer has not paid for, so there is nothing on this side
 * to hide. What this file does is make the cost visible before the click, and
 * tell the truth afterwards.
 */

export async function loadSearch(params) {
  const [tree, list, usage] = await Promise.all([
    catalog.get(),
    havale.list({
      kind: params.kind,
      carModelId: params.carModelId,
      brandId: params.brandId,
      carColor: params.carColor,
      solh: params.solh,
      maxDeliveryDays: params.maxDeliveryDays,
      minAmount: params.minAmount,
      maxAmount: params.maxAmount,
      cursor: params.cursor,
    }),
    havale.usage().catch(() => null),
  ]);

  return { tree, list, usage };
}

export function searchPage() {
  const { data, params, access } = getState();
  const { tree, list, usage } = data;
  const items = list?.items || [];

  const brands = (tree?.companies || []).flatMap((c) => c.brands);
  const models = brands.flatMap((b) => b.models);

  return html`
  <div class="card">
    <div class="card-h">
      <h2>استعلام حواله‌ها</h2>
      ${usageChip(usage)}
    </div>

    <form class="filters" data-form="search-filters">
      ${select('kind', 'نوع', [['', 'همه'], ['OFFER', 'حواله فروش'], ['REQUEST', 'درخواست خرید']], params.kind)}
      ${select('brandId', 'برند', [['', 'همه'], ...brands.map((b) => [b.id, b.name])], params.brandId)}
      ${select('carModelId', 'مدل', [['', 'همه'], ...models.map((m) => [m.id, m.name])], params.carModelId)}
      ${select('carColor', 'رنگ', [['', 'همه'], ...(tree?.colors || []).map((c) => [c.name, c.name])], params.carColor)}
      ${select('solh', 'واگذاری', [['', 'همه'], ['SOLH', 'صلح'], ['VEKALATI', 'وکالتی']], params.solh)}
      <div class="field">
        <label for="maxDeliveryDays">تحویل حداکثر (روز)</label>
        <input class="in num" id="maxDeliveryDays" name="maxDeliveryDays" inputmode="numeric"
               value="${params.maxDeliveryDays || ''}">
      </div>
      <div class="field">
        <label for="maxAmount">حداکثر مبلغ (تومان)</label>
        <input class="in num" id="maxAmount" name="maxAmount" inputmode="numeric"
               value="${params.maxAmount || ''}">
      </div>
      <div class="field" style="align-self:end;display:flex;gap:8px">
        <button class="btn primary" type="submit">اعمال</button>
        <button class="btn" type="button" data-go="search">پاک کردن</button>
      </div>
    </form>
  </div>

  ${
    !access?.active
      ? html`<div class="banner warn">
          <span class="b-ico">⚠</span>
          <div class="b-txt">
            با اشتراک منقضی، <b>کد نمایندگی، شهر و اطلاعات تماس</b> نمایش داده نمی‌شود.
          </div>
        </div>`
      : ''
  }

  ${
    items.length
      ? html`<div class="grid">${items.map(card)}</div>`
      : emptyBox('حواله‌ای با این فیلترها پیدا نشد.')
  }

  ${
    list?.nextCursor
      ? html`<div style="text-align:center;padding:12px">
          <button class="btn" data-next-cursor="${list.nextCursor}">صفحه‌ی بعد</button>
        </div>`
      : ''
  }`;
}

function select(name, label, options, current) {
  return html`<div class="field">
    <label for="${name}">${label}</label>
    <select class="in" id="${name}" name="${name}">
      ${options.map(
        ([value, text]) =>
          html`<option value="${value}" ${raw(String(value) === String(current || '') ? 'selected' : '')}>${text}</option>`
      )}
    </select>
  </div>`;
}

function card(h) {
  return html`
  <article class="hcard ${h.isOwn ? 'own' : ''}">
    <header>
      <div>
        <span class="tag ${h.kind === 'OFFER' ? '' : 'c'}">${KIND_LABEL[h.kind]}</span>
        <h3>${h.carType}</h3>
      </div>
      <span class="tag">${SOLH_LABEL[h.solh]}</span>
    </header>

    <dl>
      ${field('مبلغ حواله', money(h.amountToman))}
      ${field('پرداخت‌شده', money(h.paidAmountToman))}
      ${field('رنگ', h.carColor || 'هر رنگ')}
      ${field('مدل', h.model || '—')}
      ${field('تحویل', h.deliveryDays ? `${faDigits(h.deliveryDays)} روز` : '—')}
      ${field('شرکت', h.supplierCompany || '—')}
    </dl>

    ${h.description ? html`<p class="desc">${h.description}</p>` : ''}

    <footer>
      <div class="meta">
        <span>${h.agency?.name || '—'}</span>
        ${h.agency?.code ? html`<span class="num">${h.agency.code}</span>` : ''}
        ${h.agency?.city ? html`<span>${h.agency.city}</span>` : ''}
        <span class="tag">${until(h.closesAt)}</span>
      </div>
      ${contactArea(h)}
    </footer>
  </article>`;
}

function field(label, value) {
  return html`<div><dt>${label}</dt><dd class="num">${value}</dd></div>`;
}

/**
 * The reveal control.
 *
 * An agent must know what pressing it costs before they press it — a button that
 * silently consumes one of thirty daily views is a button people learn to fear.
 */
function contactArea(h) {
  if (h.isOwn) {
    return html`<div class="contact own">
      <span>آگهی خودتان — ${faDigits(h.revealCount || 0)} بازدید</span>
      <button class="btn sm" data-open-havale="${h.id}">جزئیات</button>
    </div>`;
  }

  if (h.contact) {
    return html`<div class="contact shown">
      <div>
        <b>${h.contact.coordinatorName}</b>
        <a class="num phone" href="tel:${h.contact.coordinatorPhone}">${h.contact.coordinatorPhone}</a>
      </div>
      <button class="btn sm" data-report="${h.id}">گزارش تخلف</button>
    </div>`;
  }

  return html`<div class="contact hidden">
    <span>اطلاعات تماس مخفی است</span>
    <button class="btn primary sm" data-reveal="${h.id}">نمایش مشخصات</button>
  </div>`;
}

/** Confirms first, because the daily allowance is small and not refundable. */
export function confirmReveal(id) {
  const { data } = getState();
  const usage = data.usage;
  const left = usage ? Math.max(0, usage.dailyLimit - usage.dailyUsed) : null;

  openModal({
    type: 'confirm',
    title: 'نمایش اطلاعات تماس',
    body: html`
      <p>با نمایش این مشخصات، <b>یک واحد از سقف روزانه‌ی شما</b> مصرف می‌شود و این بازدید
      در پنل مدیریت ثبت می‌گردد.</p>
      ${left !== null ? html`<p>باقی‌مانده‌ی امروز: <b class="num">${faDigits(left)}</b></p>` : ''}
      <p style="color:var(--ink-3);font-size:12px">باز کردن دوباره‌ی همین آگهی رایگان است.</p>`,
    confirmLabel: 'نمایش بده',
    onConfirm: () => doReveal(id),
  });
}

export async function doReveal(id) {
  try {
    await havale.reveal(id);
    toast('مشخصات تماس نمایش داده شد');
    await resolve();
  } catch (err) {
    if (err.code === 'REVEAL_LIMIT_REACHED') {
      setState({ error: err });
      toast(err.message, 'danger');
      return;
    }
    toast(err.message, 'danger');
  }
}
