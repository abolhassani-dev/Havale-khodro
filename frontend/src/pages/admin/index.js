import { html, raw } from '../../ui/html.js';
import { icon } from '../../ui/icons.js';
import { admin, reports, tickets, subscription } from '../../api/index.js';
import { getState, setState, can } from '../../state/store.js';
import {
  money, faDigits, date, dateTime, relative, enDigits,
  REPORT_REASON_LABEL, REPORT_STATUS_LABEL, TICKET_STATUS_LABEL, ROLE_LABEL,
} from '../../ui/format.js';
import { emptyBox, toast, openModal, qtip, pager, detailRow, formErrorSlot, showFormError, clearFormError } from '../../ui/feedback.js';
import { go, resolve } from '../../router.js';
import { catalogPage, loadAdminCatalog, handleCatalogClick, handleCatalogSubmit } from './catalog.js';
import { brandPicker, brandPickValue } from '../../ui/brandPicker.js';
import {
  loadStaff, staffPage, newStaffModal, editStaffModal, staffPasswordModal,
  setStaffStatus, onStaffFormChange, toggleGroup,
} from './staff.js';

/**
 * The admin panel.
 *
 * Every screen here is also gated on the server. What this side does is avoid
 * showing a support user a button that would answer 403 — courtesy, not
 * security, since this code runs on the viewer's machine.
 */

export function registerAdminRoutes(route) {
  route('adm-dash', async () => ({
    overview: await admin.overview(),
    suspicious: await admin.suspicious({ days: 7, minReveals: 20 }).catch(() => null),
  }));

  route('adm-agents', async (params) => ({
    agents: await admin.agents({ query: params.query, status: params.status, take: 50 }),
  }));

  route('adm-agent', async (params) => ({
    agent: await admin.agent(params.id),
    plans: await subscription.plans().catch(() => []),
  }));

  // The brand picker needs the catalogue, and this form cannot be submitted
  // without a brand — so it is loaded with the page rather than fetched when
  // somebody scrolls to the picker.
  route('adm-new-agent', async () => ({ catalog: await admin.catalog() }));

  route('adm-reports', async (params) => ({
    queue: await reports.queue({ status: params.status || 'PENDING' }),
    approvals: can('thirdStrike') ? await reports.pendingApproval().catch(() => []) : [],
  }));

  route('adm-tickets', async (params) => ({ list: await tickets.list(params.status) }));

  route('adm-monitor', async (params) => {
    const page = Number(params.page) || 1;
    return {
      activity: await admin.activity({ take: 50, skip: (page - 1) * 50, userId: params.userId }),
      activityPage: page,
      reveals: can('bulkContacts') ? await admin.reveals({ take: 30 }).catch(() => null) : null,
    };
  });

  route('adm-seats', async () => ({ pending: await subscription.pendingOrders() }));

  route('adm-settings', async () => ({
    settings: await admin.settings(),
    sms: await admin.smsStatus(),
    outbox: await admin.smsOutbox(20),
  }));

  route('adm-catalog', loadAdminCatalog);
  route('adm-staff', loadStaff);
}

export function renderAdminPage(page) {
  switch (page) {
    case 'adm-dash': return dashPage();
    case 'adm-agents': return agentsPage();
    case 'adm-agent': return agentPage();
    case 'adm-new-agent': return newAgentPage();
    case 'adm-reports': return reportsPage();
    case 'adm-tickets': return adminTicketsPage();
    case 'adm-monitor': return monitorPage();
    case 'adm-seats': return seatsPage();
    case 'adm-settings': return settingsPage();
    case 'adm-catalog': return catalogPage();
    case 'adm-staff': return staffPage();
    default: return emptyBox('صفحه پیدا نشد.');
  }
}

// ── dashboard ───────────────────────────────────────────────────────────────

function dashPage() {
  const { data } = getState();
  const o = data.overview || {};
  const flagged = data.suspicious?.items || [];

  return html`
  <div class="stats">
    ${stat('نمایندگی‌ها', faDigits(o.agencies ?? 0), `${faDigits(o.activeAgencies ?? 0)} فعال`, 'shield')}
    ${stat('حواله‌ی زنده', faDigits(o.liveHavales ?? 0), 'در لیست عمومی', 'file')}
    ${stat('بازدید ۲۴ ساعت', faDigits(o.revealsLast24h ?? 0), 'نمایش مشخصات', 'eye')}
    ${stat('اشتراک فعال', faDigits(o.liveSubscriptions ?? 0), '', 'clock', 'ok')}
    ${stat('گزارش در انتظار', faDigits(o.pendingReports ?? 0), o.pendingReports ? 'نیاز به بررسی' : 'خالی', 'flag', o.pendingReports ? 'warn' : '')}
    ${stat('تیکت باز', faDigits(o.openTickets ?? 0), '', 'ticket', o.openTickets ? 'warn' : '')}
  </div>

  <div class="card">
    <div class="card-h">
      <h2>رفتار قابل بررسی ${qtip('الگوهایی که ارزش نگاه دارند: نمایندگی‌ای که آگهی ندارد ولی مشخصات زیاد باز می‌کند، مصرف خیلی بالای سقف، یا اخطار تخلف. این‌ها فقط علامت‌گذاری‌اند — سامانه خودش کسی را مسدود نمی‌کند.')}</h2>
      <span class="tag ${flagged.length ? 'w' : 'g'}">${faDigits(flagged.length)} مورد</span>
    </div>
    ${
      flagged.length
        ? html`<table>
            <thead><tr><th>نمایندگی</th><th>بازدید</th><th>حواله</th><th>دلیل</th><th></th></tr></thead>
            <tbody>
              ${flagged.map(
                (row) => html`<tr>
                  <td><b>${row.agency.name || '—'}</b>
                    <div class="sub num">${row.agency.agencyCode || ''}</div></td>
                  <td class="num">${faDigits(row.reveals)}</td>
                  <td class="num">${faDigits(row.havales)}</td>
                  <td>${row.reason}</td>
                  <td style="text-align:left">
                    <button class="btn sm" data-go="adm-agent"
                            data-go-params="id=${row.agency.id}">پرونده</button>
                  </td>
                </tr>`
              )}
            </tbody>
          </table>`
        : emptyBox('رفتار غیرعادی‌ای در هفت روز گذشته دیده نشد.')
    }
    <div class="hint" style="padding:10px 14px">
      این‌ها فقط <b>علامت‌گذاری</b> است، نه مسدودسازی — سقف‌ها جلوی حجم را از قبل گرفته‌اند.
    </div>
  </div>`;
}

function stat(label, value, hint, iconName = 'dashboard', tone = '') {
  return html`<div class="stat ${tone ? `is-${tone}` : ''}">
    <span class="s-i">${icon(iconName, 19)}</span>
    <div>
      <div class="s-l">${label}</div>
      <div class="s-v num">${value}</div>
      <div class="s-h">${hint}</div>
    </div>
  </div>`;
}

/**
 * A stable hue for an agency's avatar, from its code.
 *
 * Derived, not stored: the same agency keeps the same colour everywhere and
 * forever, and colour is what the eye actually finds a row by.
 */
function hueOf(code) {
  let h = 0;
  for (const ch of String(code || '')) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

// ── agencies ────────────────────────────────────────────────────────────────

function agentsPage() {
  const { data, params } = getState();
  const items = data.agents?.items || [];

  return html`
  <div class="card">
    <div class="card-h">
      <h2>نمایندگی‌ها ${qtip('همه‌ی حساب‌های نمایندگی. از «پرونده» وضعیت، سقف‌ها، اشتراک و سابقه‌ی هر حساب را می‌بینید و می‌توانید تعلیق یا فعال کنید.')}</h2>
      <span class="tag">${faDigits(data.agents?.total ?? 0)} حساب</span>
    </div>

    <form class="filters" data-form="agent-search">
      <div class="field" style="flex:2">
        <label for="q">جستجو</label>
        <input class="in" id="q" name="query" value="${params.query || ''}"
               placeholder="کد نمایندگی، نام، موبایل">
      </div>
      <div class="field">
        <label for="st">وضعیت</label>
        <select class="in" id="st" name="status">
          <option value="">همه</option>
          <option value="ACTIVE" ${raw(params.status === 'ACTIVE' ? 'selected' : '')}>فعال</option>
          <option value="SUSPENDED" ${raw(params.status === 'SUSPENDED' ? 'selected' : '')}>تعلیق‌شده</option>
        </select>
      </div>
      <div class="field" style="align-self:end">
        <button class="btn primary" type="submit">جستجو</button>
      </div>
    </form>

    ${
      items.length
        ? html`<table class="agents-tbl">
            <thead>
              <tr><th>نمایندگی</th><th>شهر</th><th>وضعیت</th>
                  <th>اخطار</th><th>آخرین ورود</th><th></th></tr>
            </thead>
            <tbody>
              ${items.map(
                (a) => html`<tr class="${a.status === 'SUSPENDED' ? 'dim' : ''}">
                  <td>
                    <div class="agent-id">
                      <span class="agent-av" style="--h:${hueOf(a.agencyCode)}">
                        ${(a.agencyName || '؟').slice(0, 1)}
                      </span>
                      <span>
                        <b>${a.agencyName}</b>
                        ${a.isReseller ? html`<span class="tag c">ماژول</span>` : ''}
                        <span class="sub"><span class="num">${a.agencyCode}</span> · ${a.fullName}</span>
                      </span>
                    </div>
                  </td>
                  <td>${a.city}</td>
                  <td>
                    <span class="tag ${a.status === 'ACTIVE' ? 'g' : 'r'}">
                      ${a.status === 'ACTIVE' ? 'فعال' : 'تعلیق‌شده'}
                    </span>
                  </td>
                  <td class="num">${a.fakeStrikes ? faDigits(a.fakeStrikes) : '—'}</td>
                  <td>${a.lastLoginAt ? relative(a.lastLoginAt) : html`<span class="sub">هرگز</span>`}</td>
                  <td style="text-align:left">
                    <button class="btn sm" data-go="adm-agent" data-go-params="id=${a.id}">پرونده</button>
                  </td>
                </tr>`
              )}
            </tbody>
          </table>`
        : emptyBox('نمایندگی‌ای پیدا نشد.')
    }
  </div>`;
}

/** One labelled fact in the agent file: small icon, quiet label, bold value. */
function infoCell(iconName, label, value, num = false) {
  return html`<div class="af-cell">
    <span class="af-ci">${icon(iconName, 15)}</span>
    <div class="af-ct">
      <div class="af-cl">${label}</div>
      <div class="af-cv ${num ? 'num' : ''}">${value || '—'}</div>
    </div>
  </div>`;
}

function agentPage() {
  const { data } = getState();
  const a = data.agent;
  if (!a) return emptyBox('نمایندگی پیدا نشد.');

  const s = a.stats || {};
  const active = a.status === 'ACTIVE';
  const strikes = (a.fakeStrikes || 0) + (a.falseReportStrikes || 0);

  return html`
  <div class="af">
    <div class="card af-hero">
      <div class="af-id">
        <span class="agent-av af-av" style="--h:${hueOf(a.agencyCode)}">
          ${(a.agencyName || '؟').slice(0, 1)}
        </span>
        <div class="af-who">
          <div class="af-name">
            <h2>${a.agencyName}</h2>
            <span class="tag ${active ? 'g' : 'r'}">${active ? 'فعال' : 'تعلیق‌شده'}</span>
            ${a.isReseller ? html`<span class="tag c">ماژول زیرنمایندگی</span>` : ''}
            ${strikes ? html`<span class="tag o">${faDigits(strikes)} اخطار</span>` : ''}
          </div>
          <div class="af-sub">
            <span class="num">${a.agencyCode}</span> · ${a.city} ·
            عضو از <span class="num">${date(a.createdAt)}</span>
            ${!active && a.suspendedAt ? html` · تعلیق از <span class="num">${date(a.suspendedAt)}</span>` : ''}
          </div>
        </div>
        <div class="af-cta">
          <button class="btn sm" data-go="adm-monitor" data-go-params="userId=${a.id}">تایم‌لاین</button>
          ${can('subscriptions') ? html`<button class="btn primary sm" data-grant="${a.id}">صدور اشتراک</button>` : ''}
        </div>
      </div>
      ${
        can('contactEdit') || can('agents')
          ? html`<div class="af-tools">
              ${
                can('agents')
                  ? html`
                    <button class="btn sm" data-agent-brands="${a.id}">برندهای مجاز</button>
                    <button class="btn sm" data-agent-limits="${a.id}">سقف و حالت ماژول</button>`
                  : ''
              }
              ${can('contactEdit') ? html`<button class="btn sm" data-edit-agent="${a.id}">ویرایش تماس</button>` : ''}
              ${
                can('agents')
                  ? html`
                    <span class="af-gap"></span>
                    <button class="btn sm" data-agent-password="${a.id}">تغییر رمز</button>
                    <button class="btn sm" data-agent-logout="${a.id}">خروج اجباری</button>
                    <button class="btn sm ${active ? 'danger' : 'primary'}" data-agent-status="${a.id}"
                            data-status="${active ? 'SUSPENDED' : 'ACTIVE'}">
                      ${active ? 'تعلیق حساب' : 'فعال‌سازی حساب'}
                    </button>`
                  : ''
              }
            </div>`
          : ''
      }
    </div>

    <div class="stats af-stats">
      ${stat('حواله', faDigits(s.havales ?? 0), `${faDigits(s.activeHavales ?? 0)} فعال`, 'car')}
      ${stat('بازدید انجام‌شده', faDigits(s.reveals ?? 0), 'مشخصات تماس باز کرده', 'eye')}
      ${stat('گزارش داده', faDigits(s.reportsFiled ?? 0), 'روی آگهی دیگران', 'flag')}
      ${stat(
        'تخلف تأییدشده',
        faDigits(s.reportsAgainst ?? 0),
        'علیه او',
        'shield',
        (s.reportsAgainst ?? 0) > 0 ? 'bad' : 'ok'
      )}
    </div>

    <div class="cols c2">
      <div class="card">
        <div class="card-h"><h2>تماس و مشخصات</h2></div>
        <div class="af-grid">
          ${infoCell('user', 'مسئول', a.fullName)}
          ${infoCell('phone', 'موبایل', a.phone, true)}
          ${infoCell('users', 'مسئول هماهنگی', a.coordinatorName)}
          ${infoCell('phone', 'شماره‌ی هماهنگی', a.coordinatorPhone, true)}
          ${infoCell('pin', 'شهر', a.city)}
          ${infoCell('clipboard', 'نام کاربری', a.username, true)}
        </div>
      </div>

      <div class="card">
        <div class="card-h"><h2>سلامت حساب</h2></div>
        <div class="af-grid">
          ${infoCell('clock', 'آخرین ورود', a.lastLoginAt ? dateTime(a.lastLoginAt) : 'هرگز', !!a.lastLoginAt)}
          ${infoCell(
            'shield',
            'اخطار آگهی جعلی',
            a.fakeStrikes
              ? html`<span class="tag o">${faDigits(a.fakeStrikes)} اخطار</span>`
              : html`<span class="tag g">ندارد</span>`
          )}
          ${infoCell(
            'flag',
            'اخطار گزارش بی‌مورد',
            a.falseReportStrikes
              ? html`<span class="tag o">${faDigits(a.falseReportStrikes)} اخطار</span>`
              : html`<span class="tag g">ندارد</span>`
          )}
          ${infoCell(
            'settings',
            'وضعیت رمز',
            a.mustChangePassword ? html`<span class="tag n">در انتظار تغییر رمز اول</span>` : 'تغییر داده'
          )}
        </div>
        ${a.adminNote ? html`<div class="af-note"><b>یادداشت داخلی:</b> ${a.adminNote}</div>` : ''}
        <div class="hint" style="padding:10px 16px 13px">
          آنچه این نمایندگی باز کرده و انجام داده، در
          <button class="btn sm" data-go="adm-monitor" data-go-params="userId=${a.id}">تایم‌لاین</button>
          ثبت است.
        </div>
      </div>
    </div>
  </div>`;
}

function newAgentPage() {
  const { data } = getState();

  return html`
  <form class="card form" data-form="new-agent">
    <div class="card-h"><h2>ساخت حساب نمایندگی ${qtip('حساب تازه برای یک نمایندگی. رمز اولیه فقط همین یک بار نمایش داده می‌شود و نماینده در اولین ورود باید عوضش کند. انتخاب برند الزامی است — بدون آن حساب نمی‌تواند آگهی ثبت کند.')}</h2></div>
    <div style="padding:0 14px">${formErrorSlot()}</div>
    <div class="fields">
      ${field('username', 'نام کاربری', 'text', 'ltr')}
      ${field('password', 'رمز اولیه', 'text', 'ltr')}
      ${field('fullName', 'نام و نام خانوادگی')}
      ${field('phone', 'موبایل', 'tel', 'ltr')}
      ${field('agencyCode', 'کد نمایندگی', 'text', 'ltr')}
      ${field('agencyName', 'نام نمایندگی')}
      ${field('city', 'شهر')}
      ${field('coordinatorName', 'نام مسئول هماهنگی')}
      ${field('coordinatorPhone', 'موبایل مسئول هماهنگی', 'tel', 'ltr')}
      <div class="field">
        <label for="isReseller">حالت ماژول</label>
        <select class="in" id="isReseller" name="isReseller">
          <option value="false">خاموش</option>
          <option value="true">روشن — می‌تواند زیرنماینده بسازد</option>
        </select>
      </div>
      <div class="field wide">
        <label for="adminNote">یادداشت داخلی <span class="opt">(اختیاری)</span></label>
        <textarea class="in" id="adminNote" name="adminNote" rows="2"></textarea>
      </div>
    </div>

    <div style="padding:0 14px 14px">
      ${brandPicker(data.catalog?.brands || [])}
    </div>

    <div class="form-foot">
      <div class="hint">رمز اولیه یک‌بار نمایش داده می‌شود و در اولین ورود باید عوض شود.</div>
      <button class="btn primary" type="submit">بساز</button>
    </div>
  </form>`;
}

function field(name, label, type = 'text', dir = 'rtl') {
  return html`<div class="field">
    <label for="${name}">${label}</label>
    <input class="in" id="${name}" name="${name}" type="${type}" dir="${dir}" required>
  </div>`;
}

// ── reports ─────────────────────────────────────────────────────────────────

function reportsPage() {
  const { data, params } = getState();
  const queue = data.queue || [];
  const approvals = data.approvals || [];

  return html`
  ${
    approvals.length
      ? html`<div class="card">
          <div class="card-h">
            <h2>در انتظار تأیید مدیر کل ${qtip('اخطار سوم یعنی تعلیق خودکار حساب — برای همین اعمالش فقط دست مدیر کل است، نه پشتیبانی.')}</h2>
            <span class="tag w">${faDigits(approvals.length)}</span>
          </div>
          <div class="hint" style="padding:8px 14px">
            این‌ها اخطار سوم‌اند و تعلیق حساب را در پی دارند. پشتیبانی حق اعمالشان را ندارد.
          </div>
          <table>
            <thead><tr><th>حواله</th><th>نمایندگی</th><th>دلیل</th><th></th></tr></thead>
            <tbody>
              ${approvals.map(
                (r) => html`<tr>
                  <td>${r.havale.carType}</td>
                  <td>${r.havale.owner.agencyName} <span class="num">(${r.havale.owner.agencyCode})</span></td>
                  <td>${REPORT_REASON_LABEL[r.reason]}</td>
                  <td style="text-align:left">
                    <button class="btn danger sm" data-approve-suspension="${r.id}">تأیید تعلیق</button>
                  </td>
                </tr>`
              )}
            </tbody>
          </table>
        </div>`
      : ''
  }

  <div class="card">
    <div class="card-h">
      <h2>گزارش‌های تخلف ${qtip('گزارش‌هایی که نمایندگی‌ها علیه هم ثبت می‌کنند. «تأیید» برای فروشنده اخطار ثبت می‌کند و با سه اخطار حساب تعلیق می‌شود؛ «بی‌مورد» برای خود گزارش‌دهنده اخطار می‌زند تا گزارش الکی صرف نکند.')}</h2>
      <div class="tabs">
        ${[['PENDING', 'در انتظار'], ['CONFIRMED', 'تأییدشده'], ['REJECTED', 'ردشده'], ['ABUSIVE', 'بی‌مورد']].map(
          ([value, label]) => html`<button class="tab ${(params.status || 'PENDING') === value ? 'on' : ''}"
            data-go="adm-reports" data-go-params="status=${value}">${label}</button>`
        )}
      </div>
    </div>

    ${
      queue.length
        ? html`<table>
            <thead>
              <tr><th>#</th><th>حواله</th><th>آگهی‌دهنده</th><th>گزارش‌دهنده</th>
                  <th>دلیل</th><th>تاریخ</th><th></th></tr>
            </thead>
            <tbody>
              ${queue.map(
                (r) => html`<tr>
                  <td class="num">${faDigits(r.serial)}</td>
                  <td>${r.havale.carType}</td>
                  <td>${r.havale.owner.agencyName}
                    <div class="sub num">اخطار: ${faDigits(r.havale.owner.fakeStrikes)}</div></td>
                  <td>${r.reporter.agencyName || '—'}
                    <div class="sub num">بی‌مورد: ${faDigits(r.reporter.falseReportStrikes ?? 0)}</div></td>
                  <td>${REPORT_REASON_LABEL[r.reason]}</td>
                  <td>${date(r.createdAt)}</td>
                  <td style="text-align:left">
                    <button class="btn sm" data-review-report="${r.id}">بررسی</button>
                  </td>
                </tr>`
              )}
            </tbody>
          </table>`
        : emptyBox('گزارشی در این وضعیت نیست.')
    }
  </div>`;
}

export function reviewReportModal(id) {
  const { data } = getState();
  const r = (data.queue || []).find((x) => x.id === id);
  if (!r) return;

  openModal({
    type: 'form',
    title: `بررسی گزارش ${faDigits(r.serial)}`,
    wide: true,
    body: html`
      <div class="drow"><span>حواله</span><b>${r.havale.carType}</b></div>
      <div class="drow"><span>آگهی‌دهنده</span><b>${r.havale.owner.agencyName} (${r.havale.owner.agencyCode})</b></div>
      <div class="drow"><span>اخطارهای فعلی او</span><b class="num">${faDigits(r.havale.owner.fakeStrikes)}</b></div>
      <div class="drow"><span>گزارش‌دهنده</span><b>${r.reporter.agencyName || '—'}</b></div>
      <div class="drow"><span>دلیل</span><b>${REPORT_REASON_LABEL[r.reason]}</b></div>
      <p style="margin:10px 0;padding:10px;background:var(--paper-2);border-radius:var(--r-sm)">${r.description}</p>

      <div class="field">
        <label for="m-verdict">حکم</label>
        <select class="in" id="m-verdict" name="verdict" required>
          <option value="CONFIRMED">تخلف تأیید شد — حواله تعلیق + اخطار برای آگهی‌دهنده</option>
          <option value="REJECTED">گزارش رد شد — بدون اثر</option>
          <option value="ABUSIVE">گزارش بی‌مورد — اخطار برای گزارش‌دهنده</option>
        </select>
      </div>
      <div class="field">
        <label for="m-note">یادداشت</label>
        <textarea class="in" id="m-note" name="note" rows="2"></textarea>
      </div>
      <p style="color:var(--ink-3);font-size:12px">
        اگر بیشتر باید بررسی شود، «پنهان کردن موقت» حواله را از دید عموم برمی‌دارد بدون
        اینکه اخطاری ثبت شود.
      </p>`,
    confirmLabel: 'ثبت حکم',
    onSubmit: async (form) => {
      await reports.review(id, form.verdict.value, form.note.value);
      toast('گزارش بررسی شد');
      await resolve();
    },
  });
}

// ── tickets ─────────────────────────────────────────────────────────────────

function adminTicketsPage() {
  const { data, params } = getState();
  const items = data.list || [];

  return html`
  <div class="card">
    <div class="card-h">
      <h2>تیکت‌ها ${qtip('پیام‌های پشتیبانی نمایندگی‌ها: سؤال، مشکل و درخواست تمدید اشتراک. پاسخ شما در پنل خودشان زیر همان تیکت می‌آید.')}</h2>
      <div class="tabs">
        ${[['', 'همه'], ['OPEN', 'باز'], ['ANSWERED', 'پاسخ داده'], ['CLOSED', 'بسته']].map(
          ([value, label]) => html`<button class="tab ${(params.status || '') === value ? 'on' : ''}"
            data-go="adm-tickets" data-go-params="${value ? `status=${value}` : ''}">${label}</button>`
        )}
      </div>
    </div>
    ${
      items.length
        ? html`<table>
            <thead><tr><th>#</th><th>نمایندگی</th><th>موضوع</th><th>وضعیت</th><th>آخرین پاسخ</th></tr></thead>
            <tbody>
              ${items.map(
                (t) => html`<tr data-go="ticket" data-go-params="id=${t.id}" style="cursor:pointer">
                  <td class="num">${faDigits(t.serial)}</td>
                  <td>${t.agency?.name || '—'}</td>
                  <td>${t.subject}</td>
                  <td><span class="tag">${TICKET_STATUS_LABEL[t.status]}</span></td>
                  <td>${relative(t.lastReplyAt)}</td>
                </tr>`
              )}
            </tbody>
          </table>`
        : emptyBox('تیکتی نیست.')
    }
  </div>`;
}

// ── monitoring ──────────────────────────────────────────────────────────────

function monitorPage() {
  const { data } = getState();
  const activity = data.activity?.items || [];
  const reveals = data.reveals?.items;

  return html`
  <div class="card">
    <div class="card-h">
      <h2>تایم‌لاین فعالیت ${qtip('هر ورود، خروج، ثبت آگهی و نمایش مشخصات این‌جا ثبت می‌شود. روی هر ردیف کلیک کنید تا کامل بگوید چه اتفاقی افتاده.')}</h2>
      <span class="tag">صفحه‌ی ${faDigits(data.activityPage || 1)} — ${faDigits(data.activity?.total ?? 0)} رکورد</span>
    </div>
    <div class="hint" style="padding:8px 14px">
      روی هر ردیف کلیک کنید تا کامل بگوید چه اتفاقی افتاده.
    </div>
    ${
      activity.length
        ? html`<table>
            <thead><tr><th>زمان</th><th>رویداد</th><th>IP</th></tr></thead>
            <tbody>
              ${activity.map(
                (row) => html`<tr data-activity="${row.id}" style="cursor:pointer">
                  <td>${dateTime(row.createdAt)}</td>
                  <td>${row.headline}</td>
                  <td class="num">${row.ip || '—'}</td>
                </tr>`
              )}
            </tbody>
          </table>`
        : emptyBox('رکوردی نیست.')
    }
    ${pager({
      page: data.activityPage || 1,
      pages: Math.max(1, Math.ceil((data.activity?.total ?? 0) / 50)),
      go: 'adm-monitor',
      params: getState().params?.userId ? { userId: getState().params.userId } : {},
    })}
  </div>

  ${
    reveals
      ? html`<div class="card">
          <div class="card-h">
            <h2>سابقه‌ی نمایش مشخصات ${qtip('چه کسی مشخصات تماس کدام آگهی را کی دیده. شماره‌ی ثبت‌شده همان لحظه‌ی نمایش است و به‌خاطر حساسیتش فقط مدیر کل این را می‌بیند.')}</h2>
            <span class="tag r">فقط مدیر کل</span>
          </div>
          <div class="hint" style="padding:8px 14px">
            شماره‌ای که نشان داده شده، <b>همان لحظه</b> ثبت شده — نه شماره‌ی فعلی پروفایل.
          </div>
          <table>
            <thead><tr><th>زمان</th><th>بیننده</th><th>حواله</th><th>صاحب آگهی</th><th>شماره‌ی نمایش‌داده‌شده</th></tr></thead>
            <tbody>
              ${reveals.map(
                (r) => html`<tr>
                  <td>${dateTime(r.at)}</td>
                  <td>${r.viewer.name}</td>
                  <td>${r.havale.carType}</td>
                  <td>${r.owner.name} <span class="num">(${r.owner.agencyCode})</span></td>
                  <td class="num">${r.shown.phone || '—'}</td>
                </tr>`
              )}
            </tbody>
          </table>
        </div>`
      : ''
  }`;
}

export async function showActivityDetail(id) {
  try {
    const detail = await admin.activityDetail(id);
    openModal({
      type: 'info',
      title: 'جزئیات رویداد',
      wide: true,
      body: html`
        <p style="font-size:15px;line-height:2">${detail.description}</p>
        <div class="drow"><span>زمان</span><b>${dateTime(detail.createdAt)}</b></div>
        <div class="drow"><span>انجام‌دهنده</span><b>${detail.actor?.name || 'سیستم'}</b></div>
        ${detail.actor?.role ? html`<div class="drow"><span>نقش</span><b>${ROLE_LABEL[detail.actor.role]}</b></div>` : ''}
        <div class="drow"><span>IP</span><b class="num">${detail.ip || '—'}</b></div>
        ${detail.target ? html`<div class="drow"><span>هدف</span><b>${detail.target.label}</b></div>` : ''}
        ${
          detail.target?.owner
            ? html`<div class="drow"><span>صاحب آگهی</span><b>${detail.target.owner.name}</b></div>
                   <div class="drow"><span>شهر</span><b>${detail.target.owner.city || '—'}</b></div>`
            : ''
        }
        ${detail.target?.amountToman ? html`<div class="drow"><span>مبلغ</span><b>${money(detail.target.amountToman)}</b></div>` : ''}`,
    });
  } catch (err) {
    toast(err.message, 'danger');
  }
}

// ── seat orders ─────────────────────────────────────────────────────────────

function seatsPage() {
  const { data } = getState();
  const pending = data.pending || [];

  return html`
  <div class="card">
    <div class="card-h"><h2>درخواست‌های ظرفیت ${qtip('نماینده برای ساخت زیرنمایندگی ظرفیت می‌خرد. چون پرداخت دستی است، فقط بعد از دریافت وجه «تأیید» بزنید تا ظرفیت شارژ شود.')}</h2>
      <span class="tag ${pending.length ? 'w' : 'g'}">${faDigits(pending.length)} در انتظار</span></div>
    <div class="hint" style="padding:8px 14px">
      ظرفیت پیش‌پرداخت است: فقط بعد از دریافت وجه تأیید کنید.
    </div>
    ${
      pending.length
        ? html`<table>
            <thead><tr><th>#</th><th>تعداد</th><th>مبلغ واحد</th><th>جمع</th><th>توضیح</th><th>تاریخ</th><th></th></tr></thead>
            <tbody>
              ${pending.map(
                (o) => html`<tr>
                  <td class="num">${faDigits(o.serial)}</td>
                  <td class="num">${faDigits(o.seats)}</td>
                  <td class="num">${money(o.unitPriceToman)}</td>
                  <td class="num"><b>${money(o.totalToman)}</b></td>
                  <td>${o.buyerNote || '—'}</td>
                  <td>${date(o.createdAt)}</td>
                  <td class="row-actions">
                    <button class="btn primary sm" data-seat-review="${o.id}" data-approve="true">تأیید</button>
                    <button class="btn sm danger" data-seat-review="${o.id}" data-approve="false">رد</button>
                  </td>
                </tr>`
              )}
            </tbody>
          </table>`
        : emptyBox('درخواست در انتظاری نیست.')
    }
  </div>`;
}

// ── settings ────────────────────────────────────────────────────────────────

function settingsPage() {
  const { data } = getState();
  const settings = data.settings || [];
  const outbox = data.outbox || [];

  return html`
  <div class="card">
    <div class="card-h"><h2>تنظیمات سامانه ${qtip('مقادیری که بدون تغییر کد عوض می‌شوند و همان لحظه اعمال می‌شوند: قیمت ظرفیت، سقف گزارش، کلید پیامک و کد دوعاملی.')}</h2></div>
    <div class="hint" style="padding:8px 14px">
      این‌ها بدون نیاز به استقرار مجدد اعمال می‌شوند.
    </div>
    <table>
      <thead><tr><th>تنظیم</th><th>مقدار فعلی</th><th></th></tr></thead>
      <tbody>
        ${settings.map(
          (s) => html`<tr>
            <td>${s.description}</td>
            <td>
              <span class="val-chip ${s.type === 'boolean' ? (s.value ? 'on' : 'off') : ''}">
                ${s.type === 'boolean' ? (s.value ? 'روشن' : 'خاموش') : html`<span class="num">${faDigits(s.value)}</span>`}
              </span>
              ${s.isDefault ? html`<span class="tag n">پیش‌فرض</span>` : ''}
            </td>
            <td style="text-align:left">
              <button class="btn sm" data-edit-setting="${s.key}" data-type="${s.type}"
                      data-value="${s.value}">تغییر</button>
            </td>
          </tr>`
        )}
      </tbody>
    </table>
  </div>

  <div class="card">
    <div class="card-h">
      <h2>پیامک ${qtip('تا وقتی پنل پیامکی وصل نشده این کلید خاموش است: پیام‌ها ساخته و ذخیره می‌شوند ولی ارسال نمی‌شوند. بعد از قرارداد با پنل، از تنظیمات روشنش کنید.')}</h2>
      <span class="tag ${data.sms?.enabled ? 'g' : ''}">
        ${data.sms?.enabled ? 'ارسال فعال' : 'ارسال خاموش'}
      </span>
    </div>
    <div class="hint" style="padding:8px 14px">
      با کلید خاموش، پیام‌ها ساخته و ذخیره می‌شوند ولی ارسال نمی‌شوند — پس دقیقاً معلوم است
      چه چیزی قرار بوده برای چه کسی برود.
    </div>
    ${
      outbox.length
        ? html`<table>
            <thead><tr><th>زمان</th><th>گیرنده</th><th>قالب</th><th>متن</th><th>وضعیت</th></tr></thead>
            <tbody>
              ${outbox.map(
                (m) => html`<tr>
                  <td>${dateTime(m.createdAt)}</td>
                  <td class="num">${m.to}</td>
                  <td>${m.template}</td>
                  <td style="max-width:320px">${m.body}</td>
                  <td><span class="tag ${m.status === 'SENT' ? 'g' : m.status === 'FAILED' ? 'r' : ''}">${m.status}</span></td>
                </tr>`
              )}
            </tbody>
          </table>`
        : emptyBox('پیامی ثبت نشده.')
    }
  </div>`;
}

// ── event handling ──────────────────────────────────────────────────────────

export function handleAdminClick(d, el) {

  if (d.newStaff !== undefined) return newStaffModal();
  if (d.editStaff) return editStaffModal(d.editStaff);
  if (d.staffPassword) return staffPasswordModal(d.staffPassword);
  if (d.staffStatus) return setStaffStatus(d.staffStatus, d.status);
  if (d.permAll) return toggleGroup(el.closest('form'), d.permAll, true);
  if (d.permNone) return toggleGroup(el.closest('form'), d.permNone, false);
  if (d.activity) return showActivityDetail(d.activity);
  if (d.reviewReport) return reviewReportModal(d.reviewReport);
  if (d.approveSuspension) return approveSuspension(d.approveSuspension);
  if (d.seatReview) return seatReview(d.seatReview, d.approve === 'true');
  if (d.agentStatus) return setAgentStatus(d.agentStatus, d.status);
  if (d.agentPassword) return agentPasswordModal(d.agentPassword);
  if (d.agentLogout) return forceLogout(d.agentLogout);
  if (d.agentLimits) return agentLimitsModal(d.agentLimits);
  if (d.agentBrands) return agentBrandsModal(d.agentBrands);
  if (d.editAgent) return editAgentModal(d.editAgent);
  if (d.grant) return grantModal(d.grant);
  if (d.editSetting) return editSettingModal(d.editSetting, d.type, d.value);
  return handleCatalogClick(d, el);
}

export { onStaffFormChange };
export { setCatalogQuery } from './catalog.js';

export function handleAdminSubmit(form) {
  switch (form.dataset.form) {
    case 'new-agent': return submitNewAgent(form);
    case 'agent-search': return submitAgentSearch(form);
    default: return handleCatalogSubmit(form);
  }
}

function submitAgentSearch(form) {
  const params = {};
  new FormData(form).forEach((value, key) => {
    if (value !== '') params[key] = value;
  });
  go('adm-agents', params);
}

async function submitNewAgent(form) {
  clearFormError(form);
  const payload = {};
  ['username', 'password', 'fullName', 'phone', 'agencyCode', 'agencyName', 'city',
    'coordinatorName', 'coordinatorPhone', 'adminNote'].forEach((key) => {
    const value = form[key].value.trim();
    if (value) payload[key] = key.includes('hone') ? enDigits(value) : value;
  });
  payload.isReseller = form.isReseller.value === 'true';
  const picked = brandPickValue(form);
  payload.brandIds = picked.brandIds;
  payload.modelIds = picked.modelIds;

  // Refused here rather than on the server, because the server's refusal costs
  // a round trip and arrives after the reader has scrolled past the picker.
  // The server checks regardless — this is the courtesy, not the rule.
  if (!payload.brandIds.length && !payload.modelIds.length) {
    showFormError(form, new Error('حداقل یک برند یا مدل برای این نمایندگی انتخاب کنید'));
    document.querySelector('.bpick')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  try {
    const created = await admin.createAgent(payload);
    openModal({
      type: 'info',
      title: 'حساب ساخته شد',
      body: html`
        <p>این رمز فقط همین یک بار نشان داده می‌شود. آن را به نمایندگی بدهید.</p>
        <div class="drow"><span>نام کاربری</span><b class="num">${created.username}</b></div>
        <div class="drow"><span>رمز اولیه</span><b class="num">${created.initialPassword}</b></div>
        <div class="drow"><span>کد نمایندگی</span><b class="num">${created.agencyCode}</b></div>`,
    });
    form.reset();
  } catch (err) {
    showFormError(form, err);
  }
}

async function approveSuspension(id) {
  openModal({
    type: 'confirm',
    title: 'تأیید تعلیق حساب',
    tone: 'danger',
    body: html`<p>حساب تعلیق می‌شود و نشست‌هایش همان لحظه بسته می‌شود. اشتراکش دست‌نخورده می‌ماند.</p>`,
    confirmLabel: 'تعلیق کن',
    onConfirm: async () => {
      await reports.approveSuspension(id);
      toast('حساب تعلیق شد');
      await resolve();
    },
  });
}

function seatReview(id, approve) {
  openModal({
    type: 'form',
    title: approve ? 'تأیید دریافت وجه' : 'رد درخواست',
    tone: approve ? undefined : 'danger',
    body: html`
      <p>${approve ? 'ظرفیت بلافاصله به حساب نماینده اضافه می‌شود.' : 'درخواست رد می‌شود و ظرفیتی اضافه نمی‌شود.'}</p>
      <div class="field">
        <label for="m-note">یادداشت</label>
        <textarea class="in" id="m-note" name="note" rows="2"></textarea>
      </div>`,
    confirmLabel: approve ? 'تأیید' : 'رد کن',
    onSubmit: async (form) => {
      await subscription.reviewOrder(id, approve, form.note.value);
      toast(approve ? 'ظرفیت اضافه شد' : 'درخواست رد شد');
      await resolve();
    },
  });
}

async function setAgentStatus(id, status) {
  openModal({
    type: 'confirm',
    title: status === 'SUSPENDED' ? 'تعلیق حساب' : 'فعال‌سازی حساب',
    tone: status === 'SUSPENDED' ? 'danger' : undefined,
    body: html`<p>${
      status === 'SUSPENDED'
        ? 'نشست‌های فعال همان لحظه بسته می‌شود. اشتراک باطل نمی‌شود.'
        : 'حساب دوباره فعال می‌شود.'
    }</p>`,
    confirmLabel: 'انجام بده',
    onConfirm: async () => {
      await admin.setAgentStatus(id, status);
      toast('انجام شد');
      await resolve();
    },
  });
}

function agentPasswordModal(id) {
  openModal({
    type: 'form',
    title: 'تغییر رمز نمایندگی',
    body: html`<div class="field">
      <label for="m-pass">رمز جدید</label>
      <input class="in" id="m-pass" name="password" dir="ltr" minlength="8" required>
    </div>
    <p style="color:var(--ink-3);font-size:12px">نشست‌هایش بسته می‌شود و باید در ورود بعدی عوضش کند.</p>`,
    confirmLabel: 'ثبت',
    onSubmit: async (form) => {
      await admin.setAgentPassword(id, form.password.value);
      toast('رمز عوض شد');
      await resolve();
    },
  });
}

async function forceLogout(id) {
  try {
    const result = await admin.forceLogout(id);
    toast(`${faDigits(result.endedSessions)} نشست بسته شد`);
    await resolve();
  } catch (err) {
    toast(err.message, 'danger');
  }
}

/**
 * Editing an existing agency's brands.
 *
 * The choices arrive flagged from the server — the same call the picker uses
 * everywhere — so what is ticked on open is what is true, not what some cached
 * page remembers. Saving replaces the whole set; that is what a checkbox
 * screen means, and it is what makes "untick this one" expressible.
 */
async function agentBrandsModal(id) {
  let choices;
  try {
    choices = await admin.agentBrands(id);
  } catch (err) {
    return toast(err.message, 'danger');
  }

  return openModal({
    type: 'form',
    title: 'برندها و مدل‌های مجاز این نمایندگی',
    wide: true,
    body: html`
      ${brandPicker(choices.brands, {
        selected: choices.brands.filter((b) => b.allowed).map((b) => b.id),
        selectedModels: choices.modelGrants,
      })}
      <p style="color:var(--ink-3);font-size:12px;margin-top:8px">
        تغییر فوراً اعمال می‌شود. آگهی‌های قبلی سر جایشان می‌مانند — محدودیت فقط جلوی
        ثبتِ جدید را می‌گیرد. برای دسترسیِ فقط چند مدل از یک برند، روی «مدل‌ها» بزنید.
      </p>`,
    confirmLabel: 'ذخیره',
    onSubmit: async (form) => {
      const picked = brandPickValue(form);
      await admin.setAgentBrands(id, picked);
      toast('دسترسی‌ها به‌روز شد');
    },
  });
}

function agentLimitsModal(id) {
  const { data } = getState();
  const a = data.agent;

  openModal({
    type: 'form',
    title: 'سقف و حالت ماژول',
    body: html`
      <div class="field">
        <label for="m-reseller">حالت ماژول</label>
        <select class="in" id="m-reseller" name="isReseller">
          <option value="false" ${raw(a?.isReseller ? '' : 'selected')}>خاموش</option>
          <option value="true" ${raw(a?.isReseller ? 'selected' : '')}>روشن</option>
        </select>
      </div>
      <div class="field">
        <label for="m-seats">اعتبار ظرفیت</label>
        <input class="in num" id="m-seats" name="seatCredits" inputmode="numeric"
               value="${a?.seatCredits ?? 0}">
      </div>
      <div class="field">
        <label for="m-daily">سقف نمایش روزانه <span class="opt">(خالی = پلن)</span></label>
        <input class="in num" id="m-daily" name="dailyRevealLimitOverride" inputmode="numeric"
               value="${a?.dailyRevealLimitOverride ?? ''}">
      </div>
      <div class="field">
        <label for="m-monthly">سقف نمایش دوره <span class="opt">(خالی = پلن)</span></label>
        <input class="in num" id="m-monthly" name="monthlyRevealLimitOverride" inputmode="numeric"
               value="${a?.monthlyRevealLimitOverride ?? ''}">
      </div>`,
    confirmLabel: 'ثبت',
    onSubmit: async (form) => {
      const payload = {
        isReseller: form.isReseller.value === 'true',
        seatCredits: Number(enDigits(form.seatCredits.value || '0')),
        dailyRevealLimitOverride: form.dailyRevealLimitOverride.value
          ? Number(enDigits(form.dailyRevealLimitOverride.value))
          : null,
        monthlyRevealLimitOverride: form.monthlyRevealLimitOverride.value
          ? Number(enDigits(form.monthlyRevealLimitOverride.value))
          : null,
      };
      await admin.setAgentLimits(id, payload);
      toast('اعمال شد');
      await resolve();
    },
  });
}

function editAgentModal(id) {
  const { data } = getState();
  const a = data.agent;

  openModal({
    type: 'form',
    title: 'ویرایش اطلاعات تماس',
    body: html`
      <p style="color:var(--ink-3);font-size:12px">
        این فیلدها برای خود نمایندگی قفل است و فقط از اینجا عوض می‌شود. با تغییر،
        <b>همه‌ی آگهی‌های او یکجا به‌روز می‌شود</b>.
      </p>
      <div class="field"><label for="e-name">نام مسئول</label>
        <input class="in" id="e-name" name="fullName" value="${a?.fullName || ''}"></div>
      <div class="field"><label for="e-phone">موبایل</label>
        <input class="in num" id="e-phone" name="phone" dir="ltr" value="${a?.phone || ''}"></div>
      <div class="field"><label for="e-agency">نام نمایندگی</label>
        <input class="in" id="e-agency" name="agencyName" value="${a?.agencyName || ''}"></div>
      <div class="field"><label for="e-city">شهر</label>
        <input class="in" id="e-city" name="city" value="${a?.city || ''}"></div>
      <div class="field"><label for="e-cname">مسئول هماهنگی</label>
        <input class="in" id="e-cname" name="coordinatorName" value="${a?.coordinatorName || ''}"></div>
      <div class="field"><label for="e-cphone">موبایل هماهنگی</label>
        <input class="in num" id="e-cphone" name="coordinatorPhone" dir="ltr"
               value="${a?.coordinatorPhone || ''}"></div>`,
    confirmLabel: 'ثبت',
    onSubmit: async (form) => {
      const payload = {};
      ['fullName', 'phone', 'agencyName', 'city', 'coordinatorName', 'coordinatorPhone'].forEach((key) => {
        const value = form[key].value.trim();
        if (value) payload[key] = key.includes('hone') ? enDigits(value) : value;
      });
      await admin.updateAgent(id, payload);
      toast('اطلاعات به‌روز شد');
      await resolve();
    },
  });
}

function grantModal(userId) {
  const { data } = getState();
  const plans = data.plans || [];

  openModal({
    type: 'form',
    title: 'صدور اشتراک',
    body: html`
      <p style="color:var(--ink-3);font-size:12px">
        فقط بعد از دریافت وجه. دوره از <b>امروز</b> شروع می‌شود، نه از تاریخ انقضای قبلی.
      </p>
      <div class="field">
        <label for="m-plan">پلن</label>
        <select class="in" id="m-plan" name="planId" required>
          ${plans.map((p) => html`<option value="${p.id}">${p.name} — ${money(p.priceToman)}</option>`)}
        </select>
      </div>
      <div class="field">
        <label for="m-note">یادداشت (شماره پیگیری واریز)</label>
        <input class="in" id="m-note" name="note">
      </div>`,
    confirmLabel: 'صادر کن',
    onSubmit: async (form) => {
      await subscription.grant(userId, form.planId.value, form.note.value);
      toast('اشتراک صادر شد');
      await resolve();
    },
  });
}

function editSettingModal(key, type, current) {
  openModal({
    type: 'form',
    title: 'تغییر تنظیم',
    body: html`
      <div class="drow"><span>کلید</span><b class="num">${key}</b></div>
      <div class="field">
        <label for="m-val">مقدار جدید</label>
        ${
          type === 'boolean'
            ? html`<select class="in" id="m-val" name="value">
                <option value="true" ${raw(current === 'true' ? 'selected' : '')}>روشن</option>
                <option value="false" ${raw(current === 'true' ? '' : 'selected')}>خاموش</option>
              </select>`
            : html`<input class="in num" id="m-val" name="value" value="${current}" required>`
        }
      </div>`,
    confirmLabel: 'ثبت',
    onSubmit: async (form) => {
      const raw2 = form.value.value;
      const value = type === 'boolean' ? raw2 === 'true' : enDigits(raw2);
      await admin.setSetting(key, value);
      toast('تنظیم اعمال شد');
      await resolve();
    },
  });
}
