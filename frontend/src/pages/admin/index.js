import { html, raw } from '../../ui/html.js';
import { icon } from '../../ui/icons.js';
import { admin, reports, tickets, subscription } from '../../api/index.js';
import { getState, setState, can } from '../../state/store.js';
import {
  money, faDigits, date, dateTime, timeOnly, relative, enDigits, fileSize,
  KIND_LABEL, SOLH_LABEL, HAVALE_STATUS_LABEL, PAYMENT_TYPE_LABEL,
  REPORT_REASON_LABEL, REPORT_STATUS_LABEL, TICKET_STATUS_LABEL, TICKET_CATEGORIES, ROLE_LABEL,
} from '../../ui/format.js';
import { emptyBox, toast, openModal, qtip, pager, detailRow, formErrorSlot, showFormError, clearFormError } from '../../ui/feedback.js';
import { go, resolve } from '../../router.js';
import { catalogPage, loadAdminCatalog, handleCatalogClick, handleCatalogSubmit } from './catalog.js';
import { brandPicker, brandPickValue } from '../../ui/brandPicker.js';
// The conversation row is one component for both panels — the admin's list
// only adds whose conversation it is.
import { ticketItem } from '../agent/account.js';
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
  // Every loader below fires its calls together rather than one after another.
  // Written as a sequence of awaits — which is how these started — a page with
  // three calls waits three round trips for data that has no order between it,
  // and the page arrives three times slower than it needs to.
  route('adm-dash', async () => {
    const [overview, suspicious] = await Promise.all([
      admin.overview(),
      admin.suspicious({ days: 7, minReveals: 20 }).catch(() => null),
    ]);
    return { overview, suspicious };
  });

  route('adm-agents', async (params) => ({
    agents: await admin.agents({ query: params.query, status: params.status, take: 50 }),
  }));

  route('adm-agent', async (params) => {
    const [agent, plans] = await Promise.all([
      admin.agent(params.id),
      subscription.plans().catch(() => []),
    ]);
    return { agent, plans };
  });

  // The brand picker needs the catalogue, and this form cannot be submitted
  // without a brand — so it is loaded with the page rather than fetched when
  // somebody scrolls to the picker.
  route('adm-new-agent', async () => ({ catalog: await admin.catalog() }));

  route('adm-havales', async (params) => ({
    havales: await admin.havales({
      query: params.query,
      status: params.status || 'LIVE',
      kind: params.kind,
      take: 50,
    }),
  }));

  route('adm-havale', async (params) => ({ havale: await admin.havale(params.id) }));

  route('adm-reports', async (params) => {
    const [queue, approvals] = await Promise.all([
      reports.queue({ status: params.status || 'PENDING' }),
      can('thirdStrike') ? reports.pendingApproval().catch(() => []) : [],
    ]);
    return { queue, approvals };
  });

  route('adm-tickets', async (params) => ({
    list: await tickets.list(params.status, params.category),
  }));

  route('adm-monitor', async (params) => {
    const page = Number(params.page) || 1;
    const [activity, reveals] = await Promise.all([
      admin.activity({ take: 50, skip: (page - 1) * 50, userId: params.userId }),
      can('bulkContacts') ? admin.reveals({ take: 30 }).catch(() => null) : null,
    ]);
    return { activity, activityPage: page, reveals };
  });

  route('adm-seats', async () => ({ pending: await subscription.pendingOrders() }));

  route('adm-settings', async () => {
    const [settings, sms, outbox] = await Promise.all([
      admin.settings(),
      admin.smsStatus(),
      admin.smsOutbox(20),
    ]);
    return { settings, sms, outbox };
  });

  route('adm-catalog', loadAdminCatalog);
  route('adm-staff', loadStaff);
}

export function renderAdminPage(page) {
  switch (page) {
    case 'adm-dash': return dashPage();
    case 'adm-agents': return agentsPage();
    case 'adm-agent': return agentPage();
    case 'adm-new-agent': return newAgentPage();
    case 'adm-havales': return havalesPage();
    case 'adm-havale': return havalePage();
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
                  <th>زیرمجموعه</th><th>اخطار</th><th>آخرین ورود</th><th></th></tr>
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
                  <td class="num">${a._count?.children ? faDigits(a._count.children) : '—'}</td>
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
            ${
              a.parent
                ? html`<button class="tag b af-parent" data-go="adm-agent" data-go-params="id=${a.parent.id}"
                          title="پرونده‌ی نمایندگی مرکزی">
                    زیرمجموعه‌ی ${a.parent.agencyName}
                  </button>`
                : ''
            }
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
          ${
            // A sub-agency's access rides on the parent's subscription — a
            // subscription issued to it directly would sit unused and confuse.
            can('subscriptions') && !a.parent
              ? html`<button class="btn primary sm" data-grant="${a.id}">صدور اشتراک</button>`
              : ''
          }
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

    ${
      a.children?.length
        ? html`<div class="card">
            <div class="card-h">
              <h2>زیرنمایندگی‌ها</h2>
              <span class="tag n">${faDigits(a.children.length)} حساب</span>
            </div>
            <table class="agents-tbl">
              <thead>
                <tr><th>نمایندگی</th><th>شهر</th><th>وضعیت</th><th>آخرین ورود</th><th></th></tr>
              </thead>
              <tbody>
                ${a.children.map(
                  (c) => html`<tr class="${c.status === 'SUSPENDED' ? 'dim' : ''}">
                    <td>
                      <div class="agent-id">
                        <span class="agent-av sm" style="--h:${hueOf(c.agencyCode)}">
                          ${(c.agencyName || '؟').slice(0, 1)}
                        </span>
                        <span>
                          <b>${c.agencyName}</b>
                          <span class="sub"><span class="num">${c.agencyCode}</span> · ${c.fullName}</span>
                        </span>
                      </div>
                    </td>
                    <td>${c.city}</td>
                    <td>
                      <span class="tag ${c.status === 'ACTIVE' ? 'g' : 'r'}">
                        ${c.status === 'ACTIVE' ? 'فعال' : 'تعلیق‌شده'}
                      </span>
                    </td>
                    <td>${c.lastLoginAt ? relative(c.lastLoginAt) : html`<span class="sub">هرگز</span>`}</td>
                    <td style="text-align:left">
                      <button class="btn sm" data-go="adm-agent" data-go-params="id=${c.id}">پرونده</button>
                    </td>
                  </tr>`
                )}
              </tbody>
            </table>
          </div>`
        : ''
    }
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

// ── listings ────────────────────────────────────────────────────────────────

/** The five buckets somebody actually sorts listings into. */
const HAVALE_SCOPES = [
  ['LIVE', 'در بازار'],
  ['SUSPENDED', 'تعلیق‌شده'],
  ['DELETED', 'برداشته‌شده'],
  ['FULFILLED', 'فروخته‌شده'],
  ['ALL', 'همه'],
];

/**
 * Every listing in the system, from the desk that has to answer for them.
 *
 * The agency side of this is a market and shows only what is for sale. Here
 * the question is different — «find the listing this person is complaining
 * about» — so the state comes first, as tabs, and a listing that was hidden or
 * taken down is a row like any other rather than an absence.
 */
function havalesPage() {
  const { data, params } = getState();
  const items = data.havales?.items || [];
  const summary = data.havales?.summary || {};
  const scope = params.status || 'LIVE';

  return html`
  <div class="stats">
    ${stat('در بازار', faDigits(summary.live ?? 0), 'قابل دیدن برای نمایندگی‌ها', 'file', 'ok')}
    ${stat('تعلیق‌شده', faDigits(summary.suspended ?? 0), summary.suspended ? 'با دلیل، برای نماینده قابل دیدن' : 'خالی', 'flag', summary.suspended ? 'warn' : '')}
    ${stat('برداشته‌شده', faDigits(summary.deleted ?? 0), 'از بازار خارج، در سابقه مانده', 'close')}
    ${stat('کل حواله‌ها', faDigits(summary.total ?? 0), 'از ابتدا تا امروز', 'layers')}
  </div>

  <div class="card">
    <div class="card-h">
      <h2>حواله‌ها ${qtip('همه‌ی آگهی‌های سامانه در هر وضعیتی. «تعلیق» آگهی را با دلیلی که نماینده می‌خواند از بازار خارج می‌کند؛ «برداشتن» همان کار را می‌کند و آگهی را از فهرست‌های نماینده هم بیرون می‌برد. هیچ‌کدام رکورد را پاک نمی‌کند.')}</h2>
      <span class="tag">${faDigits(data.havales?.total ?? 0)} مورد</span>
    </div>

    <div class="scope-row">
      ${HAVALE_SCOPES.map(
        ([key, label]) => html`<button class="tab ${scope === key ? 'on' : ''}"
          data-go="adm-havales" data-go-params="status=${key}${params.query ? `&query=${encodeURIComponent(params.query)}` : ''}">
          ${label}
        </button>`
      )}
    </div>

    <form class="filters" data-form="havale-search">
      <input type="hidden" name="status" value="${scope}">
      <div class="field" style="flex:2">
        <label for="hq">جستجو</label>
        <input class="in" id="hq" name="query" value="${params.query || ''}"
               placeholder="شماره آگهی، خودرو، رنگ، نام یا کد نمایندگی">
      </div>
      <div class="field">
        <label for="hk">نوع</label>
        <select class="in" id="hk" name="kind">
          <option value="">هر دو</option>
          <option value="OFFER" ${raw(params.kind === 'OFFER' ? 'selected' : '')}>حواله فروش</option>
          <option value="REQUEST" ${raw(params.kind === 'REQUEST' ? 'selected' : '')}>درخواست خرید</option>
        </select>
      </div>
      <div class="field" style="align-self:end">
        <button class="btn primary" type="submit">جستجو</button>
      </div>
    </form>

    ${
      items.length
        ? html`<table class="hv-tbl">
            <thead>
              <tr><th>آگهی</th><th>نمایندگی</th><th>مبلغ</th><th>وضعیت</th>
                  <th>بازدید</th><th>ثبت</th><th></th></tr>
            </thead>
            <tbody>
              ${items.map(havaleRow)}
            </tbody>
          </table>`
        : emptyBox('حواله‌ای با این فیلترها پیدا نشد.')
    }
  </div>`;
}

/** The state badge, which is three fields collapsed into the one word people use. */
function havaleTag(h) {
  if (h.removed) return html`<span class="tag r">برداشته شد</span>`;
  if (h.status === 'SUSPENDED') return html`<span class="tag w">تعلیق</span>`;
  if (h.status === 'ACTIVE') return html`<span class="tag g">در بازار</span>`;
  return html`<span class="tag n">${HAVALE_STATUS_LABEL[h.status] || h.status}</span>`;
}

function havaleRow(h) {
  return html`<tr class="${h.removed || h.status === 'SUSPENDED' ? 'dim' : ''}">
    <td>
      <div class="hv-id">
        <b>${h.carType}</b>
        <span class="sub">
          <span class="num">#${faDigits(h.serial)}</span> · ${KIND_LABEL[h.kind] || h.kind}
          ${h.carColor ? ` · ${h.carColor}` : ''}${h.model ? ` · ${h.model}` : ''}
        </span>
      </div>
    </td>
    <td>
      ${
        h.owner
          ? html`<div class="hv-ag">
              <b>${h.owner.agencyName}</b>
              <span class="sub"><span class="num">${h.owner.agencyCode}</span> · ${h.owner.city}</span>
            </div>`
          : html`<span class="sub">—</span>`
      }
    </td>
    <td class="num">${h.amountToman ? money(h.amountToman) : '—'}</td>
    <td>${havaleTag(h)}</td>
    <td class="num">${faDigits(h.revealCount ?? 0)}</td>
    <td>${relative(h.createdAt)}</td>
    <td style="text-align:left">
      <button class="btn sm" data-go="adm-havale" data-go-params="id=${h.id}">پرونده</button>
    </td>
  </tr>`;
}

/**
 * One listing, everything on it, and the two decisions that can be taken.
 *
 * Written as a page rather than a modal because it is where somebody lands
 * from a violation report or a support ticket, and a modal cannot be linked to.
 */
function havalePage() {
  const { data } = getState();
  const h = data.havale;
  if (!h) return emptyBox('حواله پیدا نشد.');

  const owner = h.owner || {};

  return html`
  <div class="af">
  <div class="card">
    <div class="af-id">
      <span class="agent-av af-av" style="--h:${hueOf(owner.agencyCode || String(h.serial))}">
        ${(h.carType || '؟').slice(0, 1)}
      </span>
      <div class="af-who">
        <div class="af-name">
          <h2>${h.carType}</h2>
          ${havaleTag(h)}
        </div>
        <div class="af-sub">
          <span class="num">#${faDigits(h.serial)}</span> · ${KIND_LABEL[h.kind] || h.kind}
          · ${SOLH_LABEL[h.solh] || h.solh}
          ${h.brand ? ` · ${h.brand}` : ''}
        </div>
      </div>
      <div class="af-cta">
        <button class="btn sm" data-go="adm-havales">فهرست حواله‌ها</button>
      </div>
    </div>

    ${
      h.suspendReason
        ? html`<div class="hv-reason">
            ${icon('flag', 15)}
            <span><b>دلیل تعلیق:</b> ${h.suspendReason} — نماینده همین متن را روی آگهی خود می‌بیند.</span>
          </div>`
        : ''
    }

    <div class="af-grid">
      ${infoCell('layers', 'مبلغ حواله', h.amountToman ? money(h.amountToman) : '—')}
      ${infoCell('car', 'قیمت خودرو', h.carPriceToman ? money(h.carPriceToman) : '—')}
      ${infoCell('ticket', 'واریزشده', h.paidAmountToman ? money(h.paidAmountToman) : '—')}
      ${infoCell('clock', 'زمان تحویل', h.deliveryDays ? `${faDigits(h.deliveryDays)} روز` : '—')}
      ${infoCell('clock', 'مهلت واریز', h.depositDays ? `${faDigits(h.depositDays)} روز` : '—')}
      ${infoCell('car', 'رنگ و سال', [h.carColor, h.model].filter(Boolean).join(' · ') || '—')}
      ${infoCell('ticket', 'نحوه پرداخت', PAYMENT_TYPE_LABEL[h.paymentType] || '—')}
      ${infoCell('shield', 'تأمین‌کننده', h.supplierCompany || '—')}
      ${infoCell('eye', 'بازدید مشخصات', faDigits(h.revealCount ?? 0), true)}
      ${infoCell('flag', 'گزارش تخلف', faDigits(h.reportCount ?? 0), true)}
      ${infoCell('clock', 'انقضای آگهی', h.closesAt ? date(h.closesAt) : '—')}
    </div>
  </div>

  <div class="cols c2">
    <div class="card">
      <div class="card-h"><h2>نمایندگی ثبت‌کننده</h2></div>
      <div class="af-rows">
        ${detailRow('نمایندگی', owner.agencyName || '—')}
        ${detailRow('کد', owner.agencyCode || '—')}
        ${detailRow('مدیر', owner.manager || '—')}
        ${detailRow('شهر', owner.city || '—')}
        ${detailRow('نوع حساب', owner.isSubAgent ? 'زیرنمایندگی' : 'نمایندگی مرکزی')}
        ${detailRow('وضعیت حساب', owner.status === 'ACTIVE' ? 'فعال' : 'تعلیق‌شده')}
      </div>
      ${
        h.contact
          ? html`<div class="af-rows">
              ${detailRow('موبایل', h.contact.phone || '—')}
              ${detailRow('مسئول هماهنگی', h.contact.coordinatorName || '—')}
              ${detailRow('شماره هماهنگی', h.contact.coordinatorPhone || '—')}
            </div>`
          : html`<div class="hint" style="padding:10px 14px">
              مشاهده‌ی اطلاعات تماس در دسترسی این حساب نیست.
            </div>`
      }
      ${
        owner.id
          ? html`<div style="padding:10px 14px">
              <button class="btn sm" data-go="adm-agent" data-go-params="id=${owner.id}">پرونده‌ی نمایندگی</button>
            </div>`
          : ''
      }
    </div>

    <div class="card">
      <div class="card-h"><h2>تصمیم</h2></div>
      <div class="hv-acts">
        ${
          h.removed
            ? html`<div class="hv-act">
                <div>
                  <b>این آگهی برداشته شده است</b>
                  <span class="hint">در سابقه‌ی سامانه مانده، ولی هیچ نماینده‌ای آن را نمی‌بیند.</span>
                </div>
                <button class="btn primary sm" data-havale-restore="${h.id}">بازگرداندن به بازار</button>
              </div>`
            : html`
              <div class="hv-act">
                <div>
                  <b>${h.status === 'SUSPENDED' ? 'تعلیق‌شده' : 'تعلیق آگهی'}</b>
                  <span class="hint">
                    ${h.status === 'SUSPENDED'
                      ? 'از بازار خارج است و نماینده دلیل را می‌بیند.'
                      : 'از بازار خارج می‌شود و نماینده دلیلی را که می‌نویسید می‌بیند.'}
                  </span>
                </div>
                ${
                  h.status === 'SUSPENDED'
                    ? html`<button class="btn primary sm" data-havale-unsuspend="${h.id}">رفع تعلیق</button>`
                    : html`<button class="btn sm danger" data-havale-suspend="${h.id}">تعلیق آگهی</button>`
                }
              </div>
              <div class="hv-act">
                <div>
                  <b>برداشتن از سامانه</b>
                  <span class="hint">آگهی از همه‌ی فهرست‌ها بیرون می‌رود. رکورد و سابقه‌ی بازدیدها می‌ماند.</span>
                </div>
                <button class="btn sm danger" data-havale-remove="${h.id}">برداشتن</button>
              </div>`
        }
      </div>

      ${
        h.description
          ? html`<div class="card-h" style="border-top:1px solid var(--line-2)"><h2>توضیح نماینده</h2></div>
            <div class="seat-note">${h.description}</div>`
          : ''
      }

      ${
        h.reports?.length
          ? html`<div class="card-h" style="border-top:1px solid var(--line-2)"><h2>گزارش‌های این آگهی</h2></div>
            <div class="af-rows">
              ${h.reports.map((r) =>
                detailRow(
                  REPORT_REASON_LABEL[r.reason] || r.reason,
                  html`${REPORT_STATUS_LABEL[r.status] || r.status} · <span class="num">${date(r.createdAt)}</span>`
                )
              )}
            </div>`
          : ''
      }
    </div>
  </div>
  </div>`;
}

function suspendHavaleModal(id) {
  openModal({
    type: 'form',
    title: 'تعلیق آگهی',
    tone: 'danger',
    body: html`
      <div class="field">
        <label for="hv-reason">دلیل تعلیق</label>
        <textarea class="in" id="hv-reason" name="reason" rows="3" maxlength="300" required
                  placeholder="مثلاً: مبلغ با بازار نمی‌خواند و نماینده پاسخگو نیست"></textarea>
        <div class="hint">نماینده همین متن را روی آگهی خودش می‌بیند، پس طوری بنویسید که قابل رفع باشد.</div>
      </div>`,
    confirmLabel: 'تعلیق کن',
    onSubmit: async (form) => {
      await admin.setHavaleStatus(id, 'SUSPENDED', form.reason.value.trim());
      toast('آگهی تعلیق شد');
      await resolve();
    },
  });
}

function removeHavaleModal(id) {
  openModal({
    type: 'form',
    title: 'برداشتن آگهی از سامانه',
    tone: 'danger',
    body: html`
      <div class="field">
        <label for="hv-rm">دلیل</label>
        <textarea class="in" id="hv-rm" name="reason" rows="3" maxlength="300" required
                  placeholder="مثلاً: آگهی تکراری، یا خودروی نامرتبط"></textarea>
        <div class="hint">
          رکورد آگهی و سابقه‌ی بازدیدهایش پاک نمی‌شود — فقط از همه‌ی فهرست‌ها بیرون می‌رود.
          این دلیل در سابقه‌ی سامانه ثبت می‌شود.
        </div>
      </div>`,
    confirmLabel: 'بردار',
    onSubmit: async (form) => {
      await admin.setHavaleRemoved(id, true, form.reason.value.trim());
      toast('آگهی از سامانه برداشته شد');
      await resolve();
    },
  });
}

async function setHavaleBack(id, kind) {
  try {
    if (kind === 'removed') await admin.setHavaleRemoved(id, false);
    else await admin.setHavaleStatus(id, 'ACTIVE');
    toast('آگهی به بازار برگشت');
    await resolve();
  } catch (err) {
    toast(err.message, 'danger');
  }
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
  const status = params.status || '';
  const category = params.category || '';

  // The counts are of what is on screen — the same list the reader is looking
  // at — so a filtered view's numbers describe that view rather than the whole
  // queue, which would be a second, invisible truth.
  const waiting = items.filter((t) => t.status === 'OPEN').length;
  const answered = items.filter((t) => t.status === 'ANSWERED').length;

  const q = (patch) => {
    const merged = { status, category, ...patch };
    return Object.entries(merged)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${v}`)
      .join('&');
  };

  return html`
  <div class="sup">
    <div class="card">
      <div class="card-h">
        <h2>پشتیبانی ${qtip('گفتگوهای نمایندگی‌ها. «در انتظار پاسخ» یعنی نوبت ماست. با چیپ‌های موضوع، صف را به کاری که می‌خواهید انجام دهید محدود کنید.')}</h2>
        <div class="sup-counts">
          ${waiting ? html`<span class="tag w">${faDigits(waiting)} در انتظار پاسخ</span>` : ''}
          ${answered ? html`<span class="tag g">${faDigits(answered)} پاسخ داده</span>` : ''}
        </div>
      </div>

      <div class="sup-filters">
        <div class="tabs">
          ${[['', 'همه'], ['OPEN', 'در انتظار پاسخ'], ['ANSWERED', 'پاسخ داده'], ['CLOSED', 'بسته']].map(
            ([value, label]) => html`<button class="tab ${status === value ? 'on' : ''}"
              data-go="adm-tickets" data-go-params="${q({ status: value })}">${label}</button>`
          )}
        </div>
        <div class="tabs sup-cats">
          <button class="tab ${category === '' ? 'on' : ''}"
                  data-go="adm-tickets" data-go-params="${q({ category: '' })}">همه‌ی موضوع‌ها</button>
          ${TICKET_CATEGORIES.map(
            (c) => html`<button class="tab ${category === c.value ? 'on' : ''}"
              data-go="adm-tickets" data-go-params="${q({ category: c.value })}">
              ${icon(c.icon, 13)} ${c.label}
            </button>`
          )}
        </div>
      </div>

      ${
        items.length
          ? html`<div class="tk-list">
              ${items.map((t) => ticketItem(t, { go: 'ticket', withAgency: true, highlight: 'OPEN' }))}
            </div>`
          : html`<div class="tk-empty">
              ${icon('mail', 28)}
              <b>گفتگویی در این فیلتر نیست</b>
              <span>فیلتر را عوض کنید یا «همه» را بزنید.</span>
            </div>`
      }
    </div>

    ${
      // Capacity requests are support work too — somebody asking us for
      // something and waiting for an answer — so the section carries a way
      // into that queue rather than leaving it to be found elsewhere.
      can('seats')
        ? html`<div class="card sup-cross">
            <div class="card-h">
              <h2>درخواست‌های ظرفیت</h2>
              ${
                getState().badges?.pendingSeatOrders
                  ? html`<span class="tag w">${faDigits(getState().badges.pendingSeatOrders)} در انتظار</span>`
                  : html`<span class="tag g">در انتظاری نیست</span>`
              }
            </div>
            <div class="sup-cross-b">
              <span class="hint">
                خرید ظرفیت زیرنمایندگی هم نوعی درخواست است و در همین بخش پیگیری می‌شود.
              </span>
              <button class="btn sm" data-go="adm-seats">رفتن به صف ظرفیت</button>
            </div>
          </div>`
        : ''
    }
  </div>`;
}

// ── monitoring ──────────────────────────────────────────────────────────────

/**
 * Which icon and tone an activity row wears. Unknown actions fall back to a
 * clock — the feed must never die on an action added later.
 */
const TL_ICON = {
  LOGIN: ['user', 'ok'],
  LOGIN_FAILED: ['shield', 'bad'],
  LOGOUT: ['close', ''],
  PASSWORD_CHANGED: ['settings', 'warn'],
  HAVALE_CREATED: ['car', 'ok'],
  HAVALE_UPDATED: ['car', ''],
  HAVALE_RENEWED: ['clock', ''],
  HAVALE_FULFILLED: ['car', 'ok'],
  HAVALE_DELETED: ['close', 'warn'],
  CONTACT_REVEALED: ['eye', ''],
  REPORT_FILED: ['flag', 'warn'],
  REPORT_CONFIRMED: ['flag', 'bad'],
  REPORT_REJECTED: ['flag', ''],
  REPORT_MARKED_ABUSIVE: ['flag', 'warn'],
  REPORT_HELD: ['flag', 'warn'],
  ACCOUNT_SUSPENDED_BY_STRIKES: ['shield', 'bad'],
  TICKET_OPENED: ['mail', ''],
  SUBSCRIPTION_GRANTED: ['ticket', 'ok'],
  SEAT_ORDER_APPROVED: ['layers', 'ok'],
  SEAT_ORDER_REJECTED: ['layers', 'warn'],
  SUBAGENT_CREATED: ['users', 'ok'],
  SUBAGENT_SUSPENDED: ['users', 'bad'],
  SUBAGENT_ACTIVATED: ['users', 'ok'],
  SUBAGENT_PASSWORD_RESET: ['users', 'warn'],
  SUBAGENT_BRANDS_SET: ['users', ''],
  AGENT_CREATED: ['shield', 'ok'],
  AGENT_UPDATED: ['user', ''],
  AGENT_SUSPENDED: ['shield', 'bad'],
  AGENT_ACTIVATED: ['shield', 'ok'],
  AGENT_PASSWORD_RESET: ['settings', 'warn'],
  AGENT_FORCE_LOGGED_OUT: ['close', 'warn'],
  AGENT_LIMITS_CHANGED: ['settings', ''],
  CATALOG_CHANGED: ['car', ''],
};

function tlRow(row) {
  const [ic, tone] = TL_ICON[row.action] || ['clock', ''];
  return html`<div class="tl-row" data-activity="${row.id}">
    <span class="tl-i ${tone ? `is-${tone}` : ''}">${icon(ic, 16)}</span>
    <div class="tl-b">
      <div class="tl-t">${row.headline}</div>
      <div class="tl-m">
        <span class="num">${timeOnly(row.createdAt)}</span>${
          row.ip ? html` · <span class="num">${row.ip}</span>` : ''
        }
      </div>
    </div>
    <span class="tl-chev">${icon('chevron', 14)}</span>
  </div>`;
}

/** One reveal, read as the sentence it is: who saw whose number, on what. */
function rvRow(r) {
  return html`<div class="rv-row">
    <span class="agent-av sm" style="--h:${hueOf(r.viewer.agencyCode || r.viewer.name)}">
      ${(r.viewer.name || '؟').slice(0, 1)}
    </span>
    <div class="rv-b">
      <div class="rv-t"><b>${r.viewer.name}</b> شماره‌ی تماس <b>${r.owner.name}</b> را دید</div>
      <div class="rv-m">
        روی آگهی «${r.havale.carType}»
        ${r.havale.serial ? html`<span class="num">#${faDigits(r.havale.serial)}</span>` : ''}
        · <span class="num">${dateTime(r.at)}</span>
        · کد صاحب آگهی <span class="num">${r.owner.agencyCode}</span>
      </div>
    </div>
    <div class="rv-phone">
      <span class="rv-pl">شماره‌ای که دید</span>
      <b class="num">${r.shown.phone || '—'}</b>
    </div>
  </div>`;
}

function monitorPage() {
  const { data, params } = getState();
  const activity = data.activity?.items || [];
  const reveals = data.reveals?.items;

  // Day headings carry the date once, so every row can show just the clock.
  const feed = [];
  let lastDay = null;
  for (const row of activity) {
    const day = date(row.createdAt);
    if (day !== lastDay) {
      lastDay = day;
      feed.push(html`<div class="tl-day"><span class="num">${day}</span></div>`);
    }
    feed.push(tlRow(row));
  }

  return html`
  <div class="card">
    <div class="card-h">
      <h2>تایم‌لاین فعالیت ${qtip('هر ورود، خروج، ثبت آگهی و نمایش مشخصات این‌جا ثبت می‌شود. روی هر رویداد کلیک کنید تا کامل بگوید چه اتفاقی افتاده.')}</h2>
      <span class="tag">صفحه‌ی ${faDigits(data.activityPage || 1)} — ${faDigits(data.activity?.total ?? 0)} رویداد</span>
    </div>
    ${
      params?.userId
        ? html`<div class="hint tl-filter">
            فقط رویدادهای یک حساب نمایش داده می‌شود.
            <button class="btn sm" data-go="adm-monitor">نمایش همه</button>
          </div>`
        : ''
    }
    ${activity.length ? html`<div class="tl">${feed}</div>` : emptyBox('رکوردی نیست.')}
    ${pager({
      page: data.activityPage || 1,
      pages: Math.max(1, Math.ceil((data.activity?.total ?? 0) / 50)),
      go: 'adm-monitor',
      params: params?.userId ? { userId: params.userId } : {},
    })}
  </div>

  ${
    reveals
      ? html`<div class="card">
          <div class="card-h">
            <h2>چه کسی شماره‌ی چه کسی را دید ${qtip('هر بار که نماینده‌ای مشخصات تماس آگهی‌ای را باز می‌کند، این‌جا ثبت می‌شود. شماره‌ی ثبت‌شده همان لحظه‌ی نمایش است و به‌خاطر حساسیتش فقط مدیر کل این را می‌بیند.')}</h2>
            <span class="tag r">فقط مدیر کل</span>
          </div>
          <div class="hint" style="padding:8px 16px 4px">
            شماره‌ی ثبت‌شده <b>همان لحظه‌ی نمایش</b> است — اگر بعداً شماره‌ی پروفایل عوض شود، این سابقه تغییر نمی‌کند.
          </div>
          ${
            reveals.length
              ? html`<div class="rv">${reveals.map(rvRow)}</div>`
              : emptyBox('هنوز نمایشی ثبت نشده.')
          }
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

/**
 * One capacity request, as the person deciding it needs to read it.
 *
 * The old table was six columns of numbers that said nothing about *whose*
 * request it was — three identical rows, no name anywhere. The decision here
 * is «did this agency pay us?», so the card leads with the agency, states the
 * amount to look for in the bank, and shows what they already hold.
 */
/**
 * The deposit slip, which is the whole reason this card is a decision at all.
 *
 * The slip is required at request time, so «بدون فیش» here means one of two
 * things: an order placed before the rule existed, or a file that went missing.
 * Either way the reviewer should see the gap rather than a blank space, because
 * approving without a slip is exactly the mistake this section prevents.
 */
function seatReceipt(r) {
  if (!r) {
    return html`<div class="seat-slip is-none">
      ${icon('flag', 15)}
      <span>فیش واریزی پیوست نشده — پیش از تأیید، واریز را در حساب بررسی کنید.</span>
    </div>`;
  }
  const image = r.mime?.startsWith('image/');
  return html`<div class="seat-slip">
    <a class="seat-slip-v ${image ? 'is-img' : 'is-file'}" href="${r.url}" target="_blank" rel="noopener"
       title="${r.name}">
      ${image ? html`<img src="${r.url}" alt="فیش واریزی" loading="lazy">` : icon('file', 22)}
    </a>
    <div class="seat-slip-m">
      <b>فیش واریزی</b>
      <span class="seat-slip-fn">${r.name}</span>
      <span class="hint num">${fileSize(r.size)}</span>
    </div>
    <a class="btn sm" href="${r.url}" target="_blank" rel="noopener">دیدن فیش</a>
  </div>`;
}

function seatOrderCard(o) {
  const b = o.buyer;
  return html`<div class="seat-card">
    <div class="seat-who">
      <span class="agent-av" style="--h:${hueOf(b?.code || o.serial)}">
        ${(b?.name || '؟').slice(0, 1)}
      </span>
      <div class="seat-id">
        <div class="seat-name">
          <b>${b?.name || 'نمایندگی نامشخص'}</b>
          <span class="tag n">درخواست <span class="num">#${faDigits(o.serial)}</span></span>
        </div>
        <div class="seat-sub">
          ${b ? html`<span class="num">${b.code}</span> · ${b.manager} · ${b.city}` : ''}
          · <span class="num">${date(o.createdAt)}</span>
        </div>
      </div>
      ${
        b
          ? html`<button class="btn sm" data-go="adm-agent" data-go-params="id=${b.id}">پرونده</button>`
          : ''
      }
    </div>

    <div class="seat-ask">
      <div class="seat-fig">
        <span>ظرفیت درخواستی</span>
        <b class="num">${faDigits(o.seats)}</b>
      </div>
      <div class="seat-fig">
        <span>مبلغ واحد</span>
        <b class="num">${money(o.unitPriceToman)}</b>
      </div>
      <div class="seat-fig is-total">
        <span>مبلغی که باید واریز شده باشد</span>
        <b class="num">${money(o.totalToman)}</b>
      </div>
      ${
        b
          ? html`<div class="seat-fig">
              <span>وضعیت فعلی او</span>
              <b><span class="num">${faDigits(b.seatCredits)}</span> ظرفیت ·
                 <span class="num">${faDigits(b.subAgents)}</span> زیرنمایندگی</b>
            </div>`
          : ''
      }
    </div>

    ${seatReceipt(o.receipt)}

    ${
      o.buyerNote
        ? html`<div class="seat-note"><b>یادداشت نماینده:</b> ${o.buyerNote}</div>`
        : ''
    }

    <div class="seat-act">
      <span class="hint">فقط بعد از دیدن واریز در حساب، تأیید کنید.</span>
      <span class="tk-gap"></span>
      <button class="btn sm danger" data-seat-review="${o.id}" data-approve="false">رد درخواست</button>
      <button class="btn primary sm" data-seat-review="${o.id}" data-approve="true">
        تأیید و شارژ ${faDigits(o.seats)} ظرفیت
      </button>
    </div>
  </div>`;
}

function seatsPage() {
  const { data } = getState();
  const pending = data.pending || [];
  const totalSeats = pending.reduce((sum, o) => sum + o.seats, 0);
  const totalToman = pending.reduce((sum, o) => sum + o.totalToman, 0);

  return html`
  <div class="card">
    <div class="card-h">
      <h2>درخواست‌های ظرفیت ${qtip('نماینده برای ساخت زیرنمایندگی ظرفیت می‌خرد. چون پرداخت دستی است، فقط بعد از دریافت وجه «تأیید» بزنید تا ظرفیت شارژ شود.')}</h2>
      <span class="tag ${pending.length ? 'w' : 'g'}">${faDigits(pending.length)} در انتظار</span>
    </div>

    ${
      pending.length
        ? html`
          <div class="stats seat-stats">
            ${stat('در انتظار بررسی', faDigits(pending.length), 'درخواست', 'layers', 'warn')}
            ${stat('مجموع ظرفیت', faDigits(totalSeats), 'اگر همه تأیید شوند', 'users')}
            ${stat('مجموع مبلغ', money(totalToman), 'باید در حساب دیده شود', 'ticket')}
          </div>
          <div class="seat-list">${pending.map(seatOrderCard)}</div>`
        : html`<div class="tk-empty">
            ${icon('layers', 30)}
            <b>درخواست در انتظاری نیست</b>
            <span>هر وقت نمایندگی‌ای ظرفیت زیرنمایندگی بخرد، این‌جا برای تأیید می‌آید.</span>
          </div>`
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
  if (d.havaleSuspend) return suspendHavaleModal(d.havaleSuspend);
  if (d.havaleUnsuspend) return setHavaleBack(d.havaleUnsuspend, 'suspended');
  if (d.havaleRemove) return removeHavaleModal(d.havaleRemove);
  if (d.havaleRestore) return setHavaleBack(d.havaleRestore, 'removed');
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
    case 'havale-search': return submitHavaleSearch(form);
    default: return handleCatalogSubmit(form);
  }
}

function submitHavaleSearch(form) {
  const params = {};
  new FormData(form).forEach((value, key) => {
    if (value !== '') params[key] = value;
  });
  go('adm-havales', params);
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
        // For a sub-agency the server narrows the list to the family's
        // holdings and sends the model ceiling with it — the picker can only
        // offer what the save would accept.
        modelCeiling: choices.ceiling || null,
      })}
      ${
        choices.ceiling
          ? html`<div class="hint" style="margin-top:6px">
              این حساب زیرمجموعه است — فقط برندها و مدل‌های نمایندگی مرکزی‌اش قابل انتخاب‌اند.
            </div>`
          : ''
      }
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
