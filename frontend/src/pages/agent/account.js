import { html, raw } from '../../ui/html.js';
import { icon } from '../../ui/icons.js';
import { subscription, subAgents, tickets, reports, catalog } from '../../api/index.js';
import { getState, setState, isAdmin } from '../../state/store.js';
import {
  money, faDigits, date, dateTime, timeOnly, relative, enDigits, fileSize,
  TICKET_STATUS_LABEL, TICKET_CATEGORIES, TICKET_CATEGORY_LABEL, REPORT_REASON_LABEL,
} from '../../ui/format.js';
import { emptyBox, toast, openModal, qtip, formErrorSlot, showFormError, clearFormError } from '../../ui/feedback.js';
import { LIMITS } from '../../constants.js';
import { go, resolve } from '../../router.js';
import { brandPicker, brandPickValue } from '../../ui/brandPicker.js';

/** Subscription, capacity, sub-agencies, and support tickets. */

export async function loadSubscription() {
  const [me, invoice, seats, orders] = await Promise.all([
    subscription.me(),
    subscription.invoice(),
    subscription.seats().catch(() => null),
    subscription.myOrders().catch(() => []),
  ]);
  return { me, invoice, seats, orders };
}

export function subscriptionPage() {
  const { data, user } = getState();
  const { me, invoice, seats, orders } = data;

  // The menu hides this page from sub-agencies, but a bookmark or a typed hash
  // still lands here. What it would show — dates, invoices, a renew flow — is
  // the parent's business, not theirs.
  if (user?.parentId) {
    return html`
    <div class="card">
      <div class="card-h"><h2>اشتراک</h2></div>
      <div style="padding:14px" class="hint">
        حساب شما زیرمجموعه‌ی یک نمایندگی مرکزی است و اشتراک آن از اشتراک نمایندگی مرکزی
        خوانده می‌شود — نیازی به تمدید جداگانه نیست. اگر دسترسی حساب فعال نیست، با
        نمایندگی مرکزی خود هماهنگ کنید.
      </div>
    </div>`;
  }

  return html`
  <div class="cols">
    <div class="card">
      <div class="card-h"><h2>اشتراک من ${qtip('وضعیت اشتراک ماهانه‌ی شما. با پایان اشتراک، آگهی‌ها را همچنان می‌بینید ولی مشخصات تماس مخفی می‌شود و ثبت آگهی و درخواست بسته می‌شود — تا تمدید کنید.')}</h2>
        <span class="tag ${me?.active ? 'g' : 'r'}">${me?.active ? 'فعال' : 'منقضی'}</span>
      </div>
      <div style="padding:12px 14px">
        <div class="drow"><span>پلن</span><b>${me?.plan?.name || '—'}</b></div>
        <div class="drow"><span>تاریخ پایان</span><b>${date(me?.expiresAt)}</b></div>
        <div class="drow"><span>باقی‌مانده</span><b>${faDigits(me?.daysLeft ?? 0)} روز</b></div>
        <div class="drow"><span>سقف نمایش روزانه</span><b>${faDigits(me?.limits?.daily ?? 0)}</b></div>
        <div class="drow"><span>سقف این دوره</span><b>${faDigits(me?.limits?.monthly ?? 0)}</b></div>

        ${
          me?.dependsOnParent
            ? html`<div class="banner" style="margin-top:10px">
                <span class="b-ico">ⓘ</span>
                <div class="b-txt">
                  حساب شما زیرنمایندگی است و <b>تاریخ اشتراکش از نمایندگی مرکزی خوانده می‌شود</b>.
                  با تمدید نمایندگی مرکزی، دسترسی شما همان لحظه برمی‌گردد.
                </div>
              </div>`
            : ''
        }

        <div class="banner" style="margin-top:10px">
          <span class="b-ico">ⓘ</span>
          <div class="b-txt">
            پرداخت در این مرحله <b>دستی</b> است: مبلغ را واریز کنید و از بخش پشتیبانی
            تیکت بزنید تا اشتراک ثبت شود.
          </div>
        </div>
        <button class="btn primary" data-new-ticket="تمدید اشتراک" style="margin-top:10px">
          تیکت تمدید اشتراک
        </button>
      </div>
    </div>

    <div class="card">
      <div class="card-h"><h2>صورتحساب دوره‌ی بعد ${qtip('مبلغی که برای تمدید دوره‌ی بعد پرداخت می‌کنید: اشتراک ثابت نمایندگی به‌علاوه‌ی هزینه‌ی ظرفیت زیرنمایندگی‌های فعال.')}</h2></div>
      <table>
        <thead><tr><th>شرح</th><th>تعداد</th><th>مبلغ واحد</th><th>جمع</th></tr></thead>
        <tbody>
          ${(invoice?.lines || []).map(
            (line) => html`<tr>
              <td>${line.label}</td>
              <td class="num">${faDigits(line.quantity)}</td>
              <td class="num">${money(line.unitToman)}</td>
              <td class="num">${money(line.totalToman)}</td>
            </tr>`
          )}
        </tbody>
        <tfoot>
          <tr><th colspan="3">جمع کل</th><th class="num">${money(invoice?.totalToman)}</th></tr>
        </tfoot>
      </table>
    </div>
  </div>

  ${user?.isReseller ? seatsCard(seats, orders) : ''}`;
}

function seatsCard(seats, orders) {
  return html`
  <div class="card">
    <div class="card-h">
      <h2>ظرفیت زیرنمایندگی ${qtip('هر زیرنمایندگی یک ظرفیت مصرف می‌کند. اول از این‌جا ظرفیت می‌خرید، بعد در بخش «زیرنمایندگی‌ها» برایش حساب می‌سازید.')}</h2>
      <button class="btn primary sm" data-order-seats>خرید ظرفیت</button>
    </div>
    <div class="stats" style="padding:12px 14px">
      ${statChip('خریداری‌شده', faDigits(seats?.credits ?? 0))}
      ${statChip('مصرف‌شده', faDigits(seats?.used ?? 0))}
      ${statChip('آزاد', faDigits(seats?.available ?? 0))}
      ${statChip('قیمت هر ظرفیت', money(seats?.unitPriceToman))}
    </div>

    <div style="padding:0 14px 12px">
      <div class="hint">
        ظرفیت <b>پیش‌پرداخت</b> است. تعلیق یک زیرنماینده وسط دوره، ظرفیتش را تا پایان
        همان دوره آزاد نمی‌کند.
      </div>
    </div>

    ${
      orders?.length
        ? html`<table>
            <thead><tr><th>شماره</th><th>تعداد</th><th>مبلغ</th><th>وضعیت</th><th>تاریخ</th></tr></thead>
            <tbody>
              ${orders.map(
                (o) => html`<tr>
                  <td class="num">${faDigits(o.serial)}</td>
                  <td class="num">${faDigits(o.seats)}</td>
                  <td class="num">${money(o.totalToman)}</td>
                  <td>${orderTag(o.status)}</td>
                  <td>${date(o.createdAt)}</td>
                </tr>`
              )}
            </tbody>
          </table>`
        : ''
    }
  </div>`;
}

function statChip(label, value) {
  return html`<div class="stat"><div class="s-l">${label}</div><div class="s-v num">${value}</div></div>`;
}

function orderTag(status) {
  const map = { PENDING: ['w', 'در انتظار تأیید پرداخت'], PAID: ['g', 'تأیید شد'], REJECTED: ['r', 'رد شد'] };
  const [tone, label] = map[status] || ['', status];
  return html`<span class="tag ${tone}">${label}</span>`;
}

export function orderSeatsModal() {
  const { data } = getState();
  const price = data.seats?.unitPriceToman || 0;

  openModal({
    type: 'form',
    title: 'خرید ظرفیت زیرنمایندگی',
    body: html`
      <div class="field">
        <label for="seats">تعداد ظرفیت</label>
        <input class="in num" id="seats" name="seats" inputmode="numeric" min="1" required>
        <div class="hint">قیمت هر ظرفیت در هر دوره: ${money(price)}</div>
      </div>
      <div class="field">
        <label for="m-receipt">فیش واریزی</label>
        <label class="btn sm tk-clip" title="تصویر یا PDF فیش">
          ${icon('file', 15)} انتخاب فایل فیش
          <!-- No required attribute: the input is hidden behind its label, and
               the browser cannot focus a hidden control to complain about it —
               the submit button would simply do nothing. The check in onSubmit
               refuses with a sentence the person can read. -->
          <input type="file" id="m-receipt" name="receipt" hidden
                 accept="image/jpeg,image/png,image/webp,application/pdf" data-attach-input>
        </label>
        <span class="tk-attach-names hint" data-attach-names></span>
        <div class="hint">
          اول مبلغ را واریز کنید، بعد تصویر فیش را این‌جا پیوست کنید — بدون فیش،
          درخواست قابل بررسی نیست.
        </div>
      </div>
      <div class="field">
        <label for="seat-note">توضیح (اختیاری)</label>
        <input class="in" id="seat-note" name="note" maxlength="300"
               placeholder="مثلاً شماره پیگیری واریز یا نام واریزکننده">
      </div>
      <p style="color:var(--ink-3);font-size:12px">
        ظرفیت بعد از دیدن و تأیید فیش توسط ما فعال می‌شود.
      </p>`,
    confirmLabel: 'ثبت درخواست',
    onSubmit: async (form) => {
      const file = form.receipt?.files?.[0];
      if (!file) throw new Error('فیش واریزی را پیوست کنید');

      const fd = new FormData();
      fd.append('seats', enDigits(form.seats.value));
      // Optional, and multipart has no notion of «absent» — an empty string is
      // what the schema expects to strip.
      if (form.note?.value.trim()) fd.append('note', form.note.value.trim());
      fd.append('receipt', file);
      await subscription.orderSeats(fd);
      toast('درخواست ظرفیت با فیش ثبت شد');
      await resolve();
    },
  });
}

// ── sub-agencies ────────────────────────────────────────────────────────────

export async function loadSubAgents() {
  // The catalogue rides along for the sub-agency form's brand picker. The
  // parent divides its own brands, so the picker is narrowed to `canPost`
  // before it ever renders — «همه» must mean "all of mine", never "all that
  // exist", or it would tick brands the server is about to refuse.
  const [list, tree] = await Promise.all([subAgents.list(), catalog.get()]);
  // Everything the parent may hand down: brands it holds whole, and brands it
  // holds a few models of. The picker gets the partial ones with a ceiling, so
  // it can only offer what the server would accept.
  const mine = (tree.brands || []).filter((b) => b.canPost || b.postableModelIds?.length);
  return { list, parentBrands: mine };
}

export function subAgentsPage() {
  const { data } = getState();
  const seats = data.list?.seats;
  const items = data.list?.items || [];

  return html`
  <div class="card">
    <div class="card-h">
      <h2>زیرنمایندگی‌ها ${qtip('حساب‌هایی که زیرمجموعه‌ی شما هستند: اشتراکشان از اشتراک شما خوانده می‌شود و با تمدید شما، دسترسی همه‌شان برمی‌گردد. هر زیرنمایندگی یک ظرفیت مصرف می‌کند.')}</h2>
      <div style="display:flex;gap:8px;align-items:center">
        <span class="tag ${seats?.available ? 'g' : 'r'}">
          ظرفیت آزاد: ${faDigits(seats?.available ?? 0)}
        </span>
        <button class="btn primary sm" data-new-subagent ${raw(seats?.available ? '' : 'disabled')}>
          ساخت زیرنماینده
        </button>
      </div>
    </div>

    ${
      items.length
        ? html`<table>
            <thead>
              <tr><th>نمایندگی</th><th>کد</th><th>شهر</th><th>حواله</th>
                  <th>آخرین ورود</th><th>وضعیت</th><th></th></tr>
            </thead>
            <tbody>
              ${items.map(
                (c) => html`<tr>
                  <td><b>${c.agencyName}</b><div class="sub">${c.fullName}</div></td>
                  <td class="num">${c.agencyCode}</td>
                  <td>${c.city}</td>
                  <td class="num">${faDigits(c.havaleCount)}</td>
                  <td>${c.lastLoginAt ? relative(c.lastLoginAt) : 'هرگز'}</td>
                  <td>
                    <span class="tag ${c.status === 'ACTIVE' ? 'g' : 'r'}">
                      ${c.status === 'ACTIVE' ? 'فعال' : 'تعلیق‌شده'}
                    </span>
                  </td>
                  <td class="row-actions">
                    <button class="btn sm" data-subagent-brands="${c.id}">برندهای مجاز</button>
                    <button class="btn sm" data-subagent-status="${c.id}"
                            data-status="${c.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE'}">
                      ${c.status === 'ACTIVE' ? 'تعلیق' : 'فعال‌سازی'}
                    </button>
                    <button class="btn sm" data-subagent-password="${c.id}">تغییر رمز</button>
                  </td>
                </tr>`
              )}
            </tbody>
          </table>`
        : emptyBox('هنوز زیرنمایندگی نساخته‌اید.')
    }

    <div style="padding:10px 14px" class="hint">
      حواله‌های شخصی زیرنماینده‌ها و مشخصاتی که باز کرده‌اند برای شما قابل مشاهده نیست —
      فقط آمار کلی.
    </div>
  </div>`;
}

export function newSubAgentModal() {
  const parentBrands = getState().data.parentBrands || [];
  const fullBrands = parentBrands.filter((b) => b.canPost).map((b) => b.id);
  const partialModels = parentBrands.flatMap((b) =>
    b.canPost ? [] : (b.postableModelIds || []).map((id) => ({ id, brandId: b.id }))
  );
  const ceiling = Object.fromEntries(
    parentBrands.filter((b) => !b.canPost).map((b) => [b.id, b.postableModelIds || []])
  );

  openModal({
    type: 'form',
    title: 'ساخت زیرنماینده',
    wide: true,
    body: html`
      <div class="fields">
        ${modalField('username', 'نام کاربری', 'text', true, 'ltr')}
        ${modalField('password', 'رمز اولیه', 'password', true, 'ltr')}
        ${modalField('fullName', 'نام و نام خانوادگی', 'text', true)}
        ${modalField('phone', 'موبایل', 'tel', true, 'ltr')}
        ${modalField('agencyName', 'نام نمایندگی', 'text', true)}
        ${modalField('city', 'شهر', 'text', true)}
        ${modalField('coordinatorName', 'نام مسئول هماهنگی', 'text', true)}
        ${modalField('coordinatorPhone', 'موبایل مسئول هماهنگی', 'tel', true, 'ltr')}
      </div>
      <div style="margin-top:10px">
        ${brandPicker(parentBrands, {
          selected: fullBrands,
          selectedModels: partialModels,
          modelCeiling: ceiling,
          note: 'فقط برندها و مدل‌های خودتان قابل واگذاری‌اند. پیش‌فرض همه‌ی آن‌هاست — برای زیرنماینده‌ی تخصصی، با «مدل‌ها» فقط مدل خودش را بگذارید.',
        })}
      </div>
      <p style="color:var(--ink-3);font-size:12px;margin-top:8px">
        کد نمایندگی خودکار از کد شما ساخته می‌شود. رمز اولیه را به او بدهید؛ در اولین ورود
        مجبور است عوضش کند.
      </p>`,
    confirmLabel: 'بساز',
    onSubmit: async (form) => {
      const payload = {};
      ['username', 'password', 'fullName', 'phone', 'agencyName', 'city',
        'coordinatorName', 'coordinatorPhone'].forEach((key) => {
        payload[key] = key.includes('hone') ? enDigits(form[key].value.trim()) : form[key].value.trim();
      });
      const picked = brandPickValue(form);
      payload.brandIds = picked.brandIds;
      payload.modelIds = picked.modelIds;
      // Refused here as well as on the server: an empty set is expressible in
      // the picker, but a sub-agency that can post nothing is almost never what
      // was meant.
      if (!picked.brandIds.length && !picked.modelIds.length) {
        throw new Error('حداقل یک برند یا مدل برای زیرنماینده انتخاب کنید');
      }

      const child = await subAgents.create(payload);
      toast(`زیرنماینده ساخته شد — کد ${child.agencyCode}`);
      await resolve();
    },
  });
}

function modalField(name, label, type = 'text', required = false, dir = 'rtl') {
  return html`<div class="field">
    <label for="m-${name}">${label}</label>
    <input class="in" id="m-${name}" name="${name}" type="${type}" dir="${dir}"
           ${raw(required ? 'required' : '')}>
  </div>`;
}

/**
 * Editing an existing sub-agency's brands — the after-the-fact version of the
 * picker in the creation form, with the same ceiling.
 *
 * Without this, the set chosen at creation was final and only an administrator
 * could change it: a child whose work changed, or one created before its
 * brands were chosen, sent the parent to support for the parent's own
 * decision.
 */
export async function subAgentBrandsModal(id) {
  const parentBrands = getState().data.parentBrands || [];
  const ceiling = Object.fromEntries(
    parentBrands.filter((b) => !b.canPost).map((b) => [b.id, b.postableModelIds || []])
  );

  let current;
  try {
    current = await subAgents.brands(id);
  } catch (err) {
    return toast(err.message, 'danger');
  }

  return openModal({
    type: 'form',
    title: 'برندها و مدل‌های مجاز این زیرنماینده',
    wide: true,
    body: html`
      ${brandPicker(parentBrands, {
        selected: current.brandIds,
        selectedModels: current.modelGrants,
        modelCeiling: ceiling,
        note: 'فقط برندها و مدل‌های خودتان قابل واگذاری‌اند. برای دسترسیِ فقط چند مدل از یک برند، روی «مدل‌ها» بزنید.',
      })}
      <p style="color:var(--ink-3);font-size:12px;margin-top:8px">
        تغییر فوراً اعمال می‌شود. آگهی‌های قبلی سر جایشان می‌مانند — محدودیت فقط جلوی
        ثبتِ جدید را می‌گیرد.
      </p>`,
    confirmLabel: 'ذخیره',
    onSubmit: async (form) => {
      await subAgents.setBrands(id, brandPickValue(form));
      toast('برندهای زیرنماینده به‌روز شد');
      await resolve();
    },
  });
}

export function subAgentPasswordModal(id) {
  openModal({
    type: 'form',
    title: 'تغییر رمز زیرنماینده',
    body: html`
      <div class="field">
        <label for="m-pass">رمز جدید</label>
        <input class="in" id="m-pass" name="password" type="password" dir="ltr"
               minlength="${LIMITS.passwordMin}" required>
      </div>
      <p style="color:var(--ink-3);font-size:12px">
        نشست‌های فعال آن حساب بسته می‌شود و در ورود بعدی باید رمز را عوض کند.
      </p>`,
    confirmLabel: 'ثبت',
    onSubmit: async (form) => {
      await subAgents.setPassword(id, form.password.value);
      toast('رمز زیرنماینده عوض شد');
      await resolve();
    },
  });
}

// ── tickets ─────────────────────────────────────────────────────────────────

export async function loadTickets() {
  // The support hub also carries the capacity requests: buying capacity is a
  // request to us, answered by us, and the reader who wants to know «what did
  // I ask for and where is it» should not have to remember which of two pages
  // holds which kind of asking.
  const reseller = Boolean(getState().user?.isReseller);
  const [list, seatOrders, seats] = await Promise.all([
    tickets.list(),
    reseller ? subscription.myOrders().catch(() => []) : [],
    reseller ? subscription.seats().catch(() => null) : null,
  ]);
  return { list, seatOrders, seats };
}

export async function loadTicket(params) {
  return { ticket: await tickets.get(params.id) };
}

export const TICKET_PRIORITY_LABEL = { HIGH: 'فوری', NORMAL: 'عادی', LOW: 'کم' };

export function ticketTag(status) {
  const tone = { OPEN: 'w', ANSWERED: 'g', CLOSED: 'n' }[status] || '';
  return html`<span class="tag ${tone}">${TICKET_STATUS_LABEL[status]}</span>`;
}

/**
 * One conversation in a list — subject, who and when, status at a glance.
 *
 * Shared by both panels; the admin's list passes `withAgency` so the row also
 * says whose conversation it is. `highlight` marks the status that means "your
 * move" — OPEN for staff, ANSWERED for the agency — so the eye lands on what
 * needs doing first.
 */
export function ticketItem(t, { go, withAgency = false, highlight } = {}) {
  return html`<div class="tk-item ${t.status === highlight ? 'is-hot' : ''} ${t.status === 'CLOSED' ? 'dim' : ''}"
       data-go="${go}" data-go-params="id=${t.id}">
    <span class="tk-i ${{ OPEN: 'is-warn', ANSWERED: 'is-ok' }[t.status] || ''}">${icon('mail', 16)}</span>
    <div class="tk-m">
      <div class="tk-s">
        <b>${t.subject}</b>
        <span class="num tk-serial">#${faDigits(t.serial)}</span>
        ${t.priority === 'HIGH' ? html`<span class="tag r">فوری</span>` : ''}
      </div>
      <div class="tk-sub">
        ${withAgency && t.agency ? html`${t.agency.name} <span class="num">(${t.agency.code})</span> · ` : ''}
        ${t.category ? html`${TICKET_CATEGORY_LABEL[t.category] || ''} · ` : ''}
        آخرین پیام ${relative(t.lastReplyAt)}
      </div>
    </div>
    ${ticketTag(t.status)}
    <span class="tk-chev">${icon('chevron', 14)}</span>
  </div>`;
}

/** A capacity order as the agency reads its own: what it asked, where it is. */
function seatOrderRow(o) {
  const tone = { PENDING: 'w', PAID: 'g', REJECTED: 'r' }[o.status] || '';
  const label = { PENDING: 'در انتظار تأیید پرداخت', PAID: 'تأیید شد', REJECTED: 'رد شد' }[o.status];
  return html`<div class="sup-order">
    <span class="tk-i ${o.status === 'PAID' ? 'is-ok' : o.status === 'PENDING' ? 'is-warn' : ''}">
      ${icon('layers', 16)}
    </span>
    <div class="tk-m">
      <div class="tk-s">
        <b>${faDigits(o.seats)} ظرفیت زیرنمایندگی</b>
        <span class="num tk-serial">#${faDigits(o.serial)}</span>
      </div>
      <div class="tk-sub">
        ${money(o.totalToman)} · ثبت <span class="num">${date(o.createdAt)}</span>
        ${
          o.receipt
            ? html` · <a href="${o.receipt.url}" target="_blank" rel="noopener">فیش ارسالی</a>`
            : ''
        }
        ${o.adminNote ? html` · ${o.adminNote}` : ''}
      </div>
    </div>
    <span class="tag ${tone}">${label}</span>
  </div>`;
}

/**
 * The support hub.
 *
 * It used to be one flat list of tickets with a «تیکت جدید» button, which put
 * the whole burden of «what do I even call this?» on the reader. Now the page
 * starts from what they might need — six subjects, each opening a conversation
 * already filed under it — and the capacity purchase sits among them, because
 * from the agency's side it is the same act: asking us for something.
 *
 * Live conversations come first; the finished ones are kept, under their own
 * heading, because «what did they tell me last month» is a real question.
 */
export function ticketsPage() {
  const { data, user } = getState();
  const items = data.list || [];
  const reseller = Boolean(user?.isReseller);
  const orders = data.seatOrders || [];

  const live = items.filter((t) => t.status !== 'CLOSED');
  const done = items.filter((t) => t.status === 'CLOSED');
  const waiting = live.filter((t) => t.status === 'OPEN').length;
  const answered = live.filter((t) => t.status === 'ANSWERED').length;
  const pendingOrders = orders.filter((o) => o.status === 'PENDING');

  return html`
  <div class="sup">
    <div class="card sup-head">
      <div class="sup-intro">
        <h2>چطور می‌توانیم کمک کنیم؟</h2>
        <p>موضوع را انتخاب کنید تا گفتگو در همان دسته باز شود — پاسخ در همین صفحه می‌آید.</p>
      </div>
      <div class="sup-tiles">
        ${TICKET_CATEGORIES.filter((c) => c.value !== 'SEATS' || reseller).map(
          (c) =>
            html`<button class="sup-tile" data-new-ticket="" data-category="${c.value}">
              <span class="sup-ti">${icon(c.icon, 18)}</span>
              <b>${c.label}</b>
              <span>${c.hint}</span>
            </button>`
        )}
        ${
          // Buying capacity is not a conversation — it is a form with a price
          // on it — so its tile opens that form instead. It belongs here all
          // the same: this is the page for asking us for things.
          reseller
            ? html`<button class="sup-tile is-buy" data-order-seats>
                <span class="sup-ti">${icon('plus', 18)}</span>
                <b>خرید ظرفیت زیرنمایندگی</b>
                <span>
                  ${data.seats
                    ? `الان ${faDigits(data.seats.available)} ظرفیت آزاد دارید`
                    : 'ظرفیت تازه بخرید'}
                </span>
              </button>`
            : ''
        }
      </div>
    </div>

    ${
      pendingOrders.length
        ? html`<div class="banner warn sup-pending">
            <span class="b-ico">⏳</span>
            <div class="b-txt">
              <b>${faDigits(pendingOrders.length)} درخواست ظرفیت در انتظار تأیید پرداخت است</b>
              مبلغ را واریز کنید و اگر واریز کرده‌اید، از همین‌جا یک گفتگو در دسته‌ی
              «ظرفیت زیرنمایندگی» باز کنید تا سریع‌تر بررسی شود.
            </div>
          </div>`
        : ''
    }

    <div class="card">
      <div class="card-h">
        <h2>گفتگوهای جاری ${qtip('گفتگوهایی که هنوز بسته نشده‌اند. «پاسخ داده شد» یعنی نوبت شماست.')}</h2>
        <div class="sup-counts">
          ${answered ? html`<span class="tag g">${faDigits(answered)} پاسخ داده</span>` : ''}
          ${waiting ? html`<span class="tag w">${faDigits(waiting)} در انتظار پاسخ ما</span>` : ''}
          <button class="btn primary sm" data-new-ticket="">گفتگوی جدید</button>
        </div>
      </div>
      ${
        live.length
          ? html`<div class="tk-list">
              ${live.map((t) => ticketItem(t, { go: 'ticket', highlight: 'ANSWERED' }))}
            </div>`
          : html`<div class="tk-empty">
              ${icon('mail', 28)}
              <b>گفتگوی بازی ندارید</b>
              <span>از دسته‌های بالا یکی را انتخاب کنید تا شروع شود.</span>
            </div>`
      }
    </div>

    ${
      reseller && orders.length
        ? html`<div class="card">
            <div class="card-h">
              <h2>درخواست‌های ظرفیت من ${qtip('ظرفیت پیش‌پرداخت است: بعد از واریز و تأیید ما، به حسابتان اضافه می‌شود.')}</h2>
              <span class="tag n">${faDigits(orders.length)} مورد</span>
            </div>
            <div class="tk-list">${orders.map(seatOrderRow)}</div>
          </div>`
        : ''
    }

    ${
      done.length
        ? html`<div class="card">
            <div class="card-h">
              <h2>گفتگوهای قبلی ${qtip('گفتگوهای بسته‌شده. برای ادامه‌ی هرکدام، گفتگوی تازه در همان موضوع باز کنید.')}</h2>
              <span class="tag n">${faDigits(done.length)} بسته‌شده</span>
            </div>
            <div class="tk-list">${done.map((t) => ticketItem(t, { go: 'ticket' }))}</div>
          </div>`
        : ''
    }

    <div class="hint sup-foot">
      گفتگو با اشتراک منقضی هم باز می‌شود — برای هماهنگی تمدید از همین‌جا اقدام کنید.
    </div>
  </div>`;
}

/**
 * An attachment inside a bubble. An image shows a thumbnail; anything else a
 * file chip. Both open the file in a new tab — the server decides inline vs
 * download and enforces who may fetch it.
 */
function attachmentChip(a) {
  if (a.mime?.startsWith('image/')) {
    return html`<a class="tkb-img" href="${a.url}" target="_blank" rel="noopener" title="${a.name}">
      <img src="${a.url}" alt="${a.name}" loading="lazy">
    </a>`;
  }
  return html`<a class="tkb-file" href="${a.url}" target="_blank" rel="noopener">
    ${icon('file', 15)}
    <span class="tkb-fn">${a.name}</span>
    <span class="tkb-fs">${fileSize(a.size)}</span>
  </a>`;
}

/**
 * The conversation. One page for both panels — who is "me" depends on who is
 * looking: the agency's own messages sit on one side, پشتیبانی on the other,
 * and in the admin panel the sides swap, the way every messenger works.
 */
export function ticketPage() {
  const { data } = getState();
  const t = data.ticket;
  if (!t) return emptyBox('تیکت پیدا نشد.');

  const admin = isAdmin();
  const back = admin ? 'adm-tickets' : 'tickets';

  // Date once per day; bubbles carry only the clock.
  const feed = [];
  let lastDay = null;
  for (const m of t.messages) {
    const day = date(m.createdAt);
    if (day !== lastDay) {
      lastDay = day;
      feed.push(html`<div class="tl-day"><span class="num">${day}</span></div>`);
    }
    const mine = admin ? m.isStaff : !m.isStaff;
    feed.push(html`<div class="tkb ${mine ? 'mine' : ''}">
      <span class="tkb-av ${m.isStaff ? 'staff' : ''}">
        ${m.isStaff ? icon('shield', 14) : (m.author || 'ش').slice(0, 1)}
      </span>
      <div class="tkb-c">
        <div class="tkb-h">
          <b>${m.isStaff ? 'پشتیبانی فرانوکار' : m.author || 'شما'}</b>
          <span class="num">${timeOnly(m.createdAt)}</span>
        </div>
        <div class="tkb-b">${m.body}</div>
        ${m.attachments?.length ? html`<div class="tkb-files">${m.attachments.map(attachmentChip)}</div>` : ''}
      </div>
    </div>`);
  }

  return html`
  <div class="card tk-page">
    <div class="tk-head">
      <button class="btn sm tk-back" data-go="${back}">همه‌ی تیکت‌ها</button>
      <div class="tk-title">
        <h2>${t.subject}</h2>
        <div class="tk-meta">
          تیکت <span class="num">#${faDigits(t.serial)}</span>
          · باز شده <span class="num">${date(t.createdAt)}</span>
          ${admin && t.agency ? html` · ${t.agency.name} <span class="num">(${t.agency.code})</span>` : ''}
        </div>
      </div>
      <div class="tk-flags">
        ${t.category ? html`<span class="tag b">${TICKET_CATEGORY_LABEL[t.category]}</span>` : ''}
        ${t.priority !== 'NORMAL' ? html`<span class="tag ${t.priority === 'HIGH' ? 'r' : 'n'}">${TICKET_PRIORITY_LABEL[t.priority]}</span>` : ''}
        ${ticketTag(t.status)}
      </div>
    </div>

    <div class="tk-thread">${feed}</div>

    ${
      t.status === 'CLOSED'
        ? html`<div class="tk-closed">
            <span>این گفتگو بسته شده است.</span>
            ${
              admin
                ? html`<button class="btn sm" data-reopen-ticket="${t.id}">بازکردن دوباره</button>`
                : html`<button class="btn sm" data-new-ticket="${t.subject}">تیکت جدید در همین موضوع</button>`
            }
          </div>`
        : html`<form class="tk-reply" data-form="ticket-reply" data-id="${t.id}">
            ${formErrorSlot()}
            <div class="tk-box">
              <textarea class="in" name="body" rows="2" minlength="5" maxlength="4000"
                        placeholder="پیام خود را بنویسید…" required></textarea>
              <button class="btn primary" type="submit">ارسال</button>
            </div>
            <div class="tk-actions">
              <label class="btn sm tk-clip" title="پیوست عکس یا PDF">
                ${icon('file', 15)} پیوست
                <input type="file" name="files" multiple hidden
                       accept="image/jpeg,image/png,image/webp,application/pdf" data-attach-input>
              </label>
              <span class="tk-attach-names hint" data-attach-names></span>
              <span class="tk-gap"></span>
              <button class="btn sm" type="button" data-close-ticket="${t.id}">بستن گفتگو</button>
              ${
                admin
                  ? html`<span class="tk-prio">
                      اولویت:
                      ${['LOW', 'NORMAL', 'HIGH'].map(
                        (p) => html`<button class="btn sm ${t.priority === p ? 'primary' : ''}"
                                type="button" data-ticket-priority="${t.id}" data-priority="${p}">
                          ${TICKET_PRIORITY_LABEL[p]}
                        </button>`
                      )}
                    </span>`
                  : ''
              }
            </div>
          </form>`
    }
  </div>`;
}

export function newTicketModal(subject = '', category = 'OTHER') {
  openModal({
    type: 'form',
    title: 'گفتگوی جدید با پشتیبانی',
    body: html`
      <div class="field">
        <label for="m-category">موضوع گفتگو</label>
        <select class="in" id="m-category" name="category">
          ${TICKET_CATEGORIES.map(
            (c) => html`<option value="${c.value}" ${raw(c.value === category ? 'selected' : '')}>
              ${c.label}
            </option>`
          )}
        </select>
      </div>
      <div class="field">
        <label for="m-subject">عنوان</label>
        <input class="in" id="m-subject" name="subject" value="${subject}"
               placeholder="در یک جمله بگویید موضوع چیست" required>
      </div>
      <div class="field">
        <label for="m-priority">اولویت</label>
        <select class="in" id="m-priority" name="priority">
          <option value="NORMAL">عادی</option>
          <option value="LOW">کم</option>
          <option value="HIGH">فوری</option>
        </select>
      </div>
      <div class="field">
        <label for="m-body">شرح</label>
        <textarea class="in" id="m-body" name="body" rows="4" minlength="5" required></textarea>
      </div>
      <div class="field">
        <label>پیوست <span class="opt">(اختیاری — عکس یا PDF، حداکثر ۳ فایل)</span></label>
        <label class="btn sm tk-clip" title="پیوست عکس یا PDF">
          ${icon('file', 15)} انتخاب فایل
          <input type="file" name="files" multiple hidden
                 accept="image/jpeg,image/png,image/webp,application/pdf" data-attach-input>
        </label>
        <span class="tk-attach-names hint" data-attach-names></span>
      </div>`,
    confirmLabel: 'ثبت تیکت',
    onSubmit: async (form) => {
      const files = form.files?.files || [];
      let created;
      if (files.length) {
        const fd = new FormData();
        fd.append('subject', form.subject.value);
        fd.append('category', form.category.value);
        fd.append('priority', form.priority.value);
        fd.append('body', form.body.value);
        for (const f of files) fd.append('files', f);
        created = await tickets.createForm(fd);
      } else {
        created = await tickets.create({
          subject: form.subject.value,
          category: form.category.value,
          priority: form.priority.value,
          body: form.body.value,
        });
      }
      toast('تیکت ثبت شد');
      go('ticket', { id: created.id });
      await resolve();
    },
  });
}

export async function submitTicketReply(form) {
  clearFormError(form);
  try {
    const files = form.files?.files || [];
    if (files.length) {
      const fd = new FormData();
      fd.append('body', form.body.value);
      for (const f of files) fd.append('files', f);
      await tickets.replyForm(form.dataset.id, fd);
    } else {
      await tickets.reply(form.dataset.id, form.body.value);
    }
    await resolve();
  } catch (err) {
    showFormError(form, err);
  }
}

// ── violation reports ───────────────────────────────────────────────────────

export function reportModal(havaleId) {
  openModal({
    type: 'form',
    title: 'گزارش تخلف',
    body: html`
      <div class="field">
        <label for="m-reason">دلیل</label>
        <select class="in" id="m-reason" name="reason" required>
          ${Object.entries(REPORT_REASON_LABEL).map(
            ([value, label]) => html`<option value="${value}">${label}</option>`
          )}
        </select>
        <div class="hint">
          برای «عدم پاسخگویی» باید قبلاً مشخصات تماس این آگهی را باز کرده باشید.
        </div>
      </div>
      <div class="field">
        <label for="m-desc">توضیح</label>
        <textarea class="in" id="m-desc" name="description" rows="4"
                  minlength="${LIMITS.reportDescriptionMin}" required></textarea>
        <div class="hint">حداقل ${faDigits(LIMITS.reportDescriptionMin)} کاراکتر</div>
      </div>
      <p style="color:var(--ink-3);font-size:12px">
        گزارش بی‌مورد در پرونده‌ی <b>خود شما</b> ثبت می‌شود. با سه گزارش بی‌مورد، حساب
        تعلیق می‌شود.
      </p>`,
    confirmLabel: 'ثبت گزارش',
    onSubmit: async (form) => {
      await reports.file({
        havaleId,
        reason: form.reason.value,
        description: form.description.value,
      });
      toast('گزارش ثبت شد و بررسی می‌شود');
      await resolve();
    },
  });
}
