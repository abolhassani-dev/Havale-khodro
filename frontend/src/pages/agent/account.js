import { html, raw } from '../../ui/html.js';
import { subscription, subAgents, tickets, reports } from '../../api/index.js';
import { getState, setState } from '../../state/store.js';
import {
  money, faDigits, date, dateTime, relative, enDigits,
  TICKET_STATUS_LABEL, REPORT_REASON_LABEL,
} from '../../ui/format.js';
import { emptyBox, toast, openModal, errorBox } from '../../ui/feedback.js';
import { LIMITS } from '../../constants.js';
import { go, resolve } from '../../router.js';

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

  return html`
  <div class="cols">
    <div class="card">
      <div class="card-h"><h2>اشتراک من</h2>
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
                  حساب شما زیرنمایندگی است و <b>تاریخ اشتراکش از نماینده‌ی مادر خوانده می‌شود</b>.
                  با تمدید مادر، دسترسی شما همان لحظه برمی‌گردد.
                </div>
              </div>`
            : ''
        }

        <div class="banner" style="margin-top:10px">
          <span class="b-ico">⌥</span>
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
      <div class="card-h"><h2>صورتحساب دوره‌ی بعد</h2></div>
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
      <h2>ظرفیت زیرنمایندگی</h2>
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
        <label for="note">توضیح <span class="opt">(اختیاری)</span></label>
        <textarea class="in" id="note" name="note" rows="2" maxlength="500"></textarea>
      </div>
      <p style="color:var(--ink-3);font-size:12px">
        پس از ثبت، مبلغ را واریز کنید. ظرفیت بعد از تأیید پرداخت توسط ما فعال می‌شود.
      </p>`,
    confirmLabel: 'ثبت درخواست',
    onSubmit: async (form) => {
      await subscription.orderSeats(Number(enDigits(form.seats.value)), form.note.value);
      toast('درخواست ظرفیت ثبت شد');
      await resolve();
    },
  });
}

// ── sub-agencies ────────────────────────────────────────────────────────────

export async function loadSubAgents() {
  return { list: await subAgents.list() };
}

export function subAgentsPage() {
  const { data } = getState();
  const seats = data.list?.seats;
  const items = data.list?.items || [];

  return html`
  <div class="card">
    <div class="card-h">
      <h2>زیرنمایندگی‌ها</h2>
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
  return { list: await tickets.list() };
}

export async function loadTicket(params) {
  return { ticket: await tickets.get(params.id) };
}

export function ticketsPage() {
  const { data } = getState();
  const items = data.list || [];

  return html`
  <div class="card">
    <div class="card-h">
      <h2>پشتیبانی</h2>
      <button class="btn primary sm" data-new-ticket="">تیکت جدید</button>
    </div>
    ${
      items.length
        ? html`<table>
            <thead><tr><th>شماره</th><th>موضوع</th><th>وضعیت</th><th>آخرین پاسخ</th></tr></thead>
            <tbody>
              ${items.map(
                (t) => html`<tr data-go="ticket" data-go-params="id=${t.id}" style="cursor:pointer">
                  <td class="num">${faDigits(t.serial)}</td>
                  <td>${t.subject}</td>
                  <td>${ticketTag(t.status)}</td>
                  <td>${relative(t.lastReplyAt)}</td>
                </tr>`
              )}
            </tbody>
          </table>`
        : emptyBox('تیکتی ندارید.')
    }
    <div class="hint" style="padding:10px 14px">
      تیکت با اشتراک منقضی هم باز می‌شود — برای هماهنگی تمدید از همین‌جا اقدام کنید.
    </div>
  </div>`;
}

function ticketTag(status) {
  const tone = { OPEN: 'w', ANSWERED: 'g', CLOSED: '' }[status] || '';
  return html`<span class="tag ${tone}">${TICKET_STATUS_LABEL[status]}</span>`;
}

export function ticketPage() {
  const { data, error } = getState();
  const t = data.ticket;
  if (!t) return emptyBox('تیکت پیدا نشد.');

  return html`
  <div class="card">
    <div class="card-h">
      <div>
        <h2>${t.subject}</h2>
        <div class="crumb">تیکت ${faDigits(t.serial)} · ${dateTime(t.createdAt)}</div>
      </div>
      ${ticketTag(t.status)}
    </div>

    <div class="thread">
      ${t.messages.map(
        (m) => html`<div class="msg ${m.isStaff ? 'staff' : ''}">
          <div class="msg-h"><b>${m.author || 'شما'}</b><span>${dateTime(m.createdAt)}</span></div>
          <div class="msg-b">${m.body}</div>
        </div>`
      )}
    </div>

    ${
      t.status === 'CLOSED'
        ? html`<div class="hint" style="padding:12px 14px">
            این تیکت بسته شده است. برای ادامه، تیکت تازه باز کنید.
          </div>`
        : html`<form class="reply" data-form="ticket-reply" data-id="${t.id}">
            ${errorBox(error)}
            <textarea class="in" name="body" rows="3" minlength="5" maxlength="4000"
                      placeholder="پاسخ شما…" required></textarea>
            <div class="reply-foot">
              <button class="btn" type="button" data-close-ticket="${t.id}">بستن تیکت</button>
              <button class="btn primary" type="submit">ارسال</button>
            </div>
          </form>`
    }
  </div>`;
}

export function newTicketModal(subject = '') {
  openModal({
    type: 'form',
    title: 'تیکت جدید',
    body: html`
      <div class="field">
        <label for="m-subject">موضوع</label>
        <input class="in" id="m-subject" name="subject" value="${subject}" required>
      </div>
      <div class="field">
        <label for="m-priority">اولویت</label>
        <select class="in" id="m-priority" name="priority">
          <option value="NORMAL">عادی</option>
          <option value="LOW">کم</option>
          <option value="HIGH">زیاد</option>
        </select>
      </div>
      <div class="field">
        <label for="m-body">شرح</label>
        <textarea class="in" id="m-body" name="body" rows="4" minlength="5" required></textarea>
      </div>`,
    confirmLabel: 'ثبت تیکت',
    onSubmit: async (form) => {
      const created = await tickets.create({
        subject: form.subject.value,
        priority: form.priority.value,
        body: form.body.value,
      });
      toast('تیکت ثبت شد');
      go('ticket', { id: created.id });
      await resolve();
    },
  });
}

export async function submitTicketReply(form) {
  setState({ error: null });
  try {
    await tickets.reply(form.dataset.id, form.body.value);
    await resolve();
  } catch (err) {
    setState({ error: err });
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
          برای «عدم پاسخگویی» باید قبلاً مشخصات تماس این حواله را باز کرده باشید.
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
