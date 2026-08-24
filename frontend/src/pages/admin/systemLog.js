import { html } from '../../ui/html.js';
import { icon } from '../../ui/icons.js';
import { systemLog } from '../../api/index.js';
import { getState } from '../../state/store.js';
import { faDigits, dateTime, relative } from '../../ui/format.js';
import { emptyBox, toast, openModal, qtip } from '../../ui/feedback.js';
import { resolve } from '../../router.js';

/**
 * The technical log: what broke, and what was slow.
 *
 * ── Why this is a separate screen from monitoring ───────────────────────────
 *
 * Monitoring answers «چه کسی چه کاری کرد» and belongs to whoever runs the
 * business. This answers «سامانه چه مشکلی داشت» and belongs to whoever fixes
 * it. Putting a stack trace in front of the person approving capacity orders
 * serves nobody, and neither does making an engineer scroll past sign-ins.
 *
 * It sits behind the `errorLog` permission, which is the owner's alone.
 *
 * ── Two tabs, one table ─────────────────────────────────────────────────────
 *
 * Errors and slow requests share a table on the server and collapse the same
 * way — identical incidents become one row with a count. They do not share a
 * list, because they are different jobs on different days: an error is
 * something to fix, a slow route is something to measure.
 */

const TABS = [
  { key: 'error', label: 'خطاها', icon: 'flag' },
  { key: 'slow', label: 'درخواست‌های کند', icon: 'clock' },
  { key: 'resolved', label: 'رسیدگی‌شده', icon: 'shield' },
];

/** The tab's key resolved into what the API wants. */
function query(params) {
  const tab = params.tab || 'error';
  return {
    level: tab === 'slow' ? 'slow' : 'error',
    resolved: tab === 'resolved',
    take: 50,
  };
}

export async function loadSystemLog(params) {
  return { errors: await systemLog.list(query(params)) };
}

export function systemLogPage() {
  const { data, params } = getState();
  const tab = params.tab || 'error';
  const items = data.errors?.items || [];

  return html`
  <div class="card">
    <div class="card-h">
      <h2>
        لاگ فنی
        ${qtip('خطاهای سامانه و درخواست‌هایی که بیش از حد طول کشیده‌اند. خطاهای یکسان روی یک ردیف جمع می‌شوند و شمارنده می‌گیرند — یک باگ که پنج هزار بار تکرار شده نباید چهار تای دیگر را دفن کند.')}
      </h2>
      <div class="tabs">
        ${TABS.map(
          (t) => html`<button class="tab ${tab === t.key ? 'on' : ''}"
            data-go="adm-errors" data-go-params="${t.key === 'error' ? '' : `tab=${t.key}`}">${t.label}</button>`
        )}
      </div>
      <span class="tag">${faDigits(data.errors?.total ?? 0)} مورد</span>
    </div>

    ${
      items.length
        ? html`<div class="elog">${items.map((row) => (tab === 'slow' ? slowRow(row) : errorRow(row)))}</div>`
        : emptyBox(
            tab === 'slow'
              ? 'هیچ درخواستی از آستانه کندتر نبوده. این خبر خوبی است.'
              : tab === 'resolved'
                ? 'چیزی به‌عنوان رسیدگی‌شده علامت نخورده.'
                : 'هیچ خطای بازی نیست.'
          )
    }
  </div>

  <div class="card">
    <div class="card-h"><h2>کانال هشدار</h2></div>
    <div class="hint" style="padding:12px 16px">
      هشدارها به تلگرام می‌روند. کانالی که کسی آزمایشش نکرده، کانال هشدار نیست —
      این دکمه یک پیام واقعی از همین سرور می‌فرستد.
      <div style="margin-top:10px"><button class="btn" data-test-alert>ارسال پیام آزمایشی</button></div>
    </div>
  </div>`;
}

/** How loud this one is. A count is the difference between a bug and a fire. */
function heat(count) {
  if (count >= 50) return 'r';
  if (count >= 5) return 'w';
  return 'n';
}

function errorRow(row) {
  return html`<div class="elog-row" data-error="${row.id}">
    <span class="elog-i is-${heat(row.count)}">${icon('flag', 15)}</span>
    <div class="elog-b">
      <div class="elog-t is-tech">${row.message}</div>
      <div class="elog-m">
        <span class="is-tech">${row.method || ''} ${row.path || ''}</span>
        · آخرین بار ${relative(row.lastSeen)}
        ${row.user?.agencyName ? html` · ${row.user.agencyName}` : ''}
      </div>
    </div>
    <span class="tag ${heat(row.count)} num">${faDigits(row.count)}×</span>
    <span class="tl-chev">${icon('chevron', 14)}</span>
  </div>`;
}

/** Seconds, not milliseconds, past a second — «۱٫۸ ثانیه» reads, ۱۸۰۰ does not. */
function duration(ms) {
  if (!ms) return '—';
  if (ms < 1000) return `${faDigits(ms)} میلی‌ثانیه`;
  return `${faDigits((ms / 1000).toFixed(1))} ثانیه`;
}

function slowRow(row) {
  return html`<div class="elog-row" data-error="${row.id}">
    <span class="elog-i is-${heat(row.count)}">${icon('clock', 15)}</span>
    <div class="elog-b">
      <div class="elog-t is-tech">${row.message}</div>
      <div class="elog-m">
        بدترین زمان <b>${duration(row.durationMs)}</b>
        · آخرین بار ${relative(row.lastSeen)}
      </div>
    </div>
    <span class="tag ${heat(row.count)} num">${faDigits(row.count)}×</span>
    <span class="tl-chev">${icon('chevron', 14)}</span>
  </div>`;
}

export async function showErrorDetail(id) {
  try {
    const row = await systemLog.get(id);
    const slow = row.level === 'slow';

    openModal({
      type: 'info',
      wide: true,
      title: slow ? 'درخواست کند' : 'جزئیات خطا',
      body: html`
        <p class="is-tech" style="font-size:14px;line-height:1.9">${row.message}</p>
        <div class="drow"><span>مسیر</span><b class="is-tech">${row.method || ''} ${row.path || '—'}</b></div>
        <div class="drow"><span>تعداد</span><b class="num">${faDigits(row.count)} بار</b></div>
        <div class="drow"><span>اولین بار</span><b>${dateTime(row.firstSeen)}</b></div>
        <div class="drow"><span>آخرین بار</span><b>${dateTime(row.lastSeen)}</b></div>
        ${slow ? html`<div class="drow"><span>بدترین زمان</span><b>${duration(row.durationMs)}</b></div>` : ''}
        ${row.statusCode ? html`<div class="drow"><span>کد پاسخ</span><b class="num">${faDigits(row.statusCode)}</b></div>` : ''}
        ${row.user ? html`<div class="drow"><span>کاربر</span><b>${row.user.agencyName || row.user.username}</b></div>` : ''}
        ${
          // The suggested first step. Written for the failures this system has
          // actually produced, so it is a lead rather than generic advice.
          row.help && !slow
            ? html`<div class="elog-help">${icon('wrench', 15)}<div>${row.help}</div></div>`
            : ''
        }
        ${row.stack ? html`<pre class="elog-stack">${row.stack}</pre>` : ''}
        ${
          row.resolvedAt
            ? html`<div class="hint">رسیدگی‌شده در ${dateTime(row.resolvedAt)}${row.note ? html` — ${row.note}` : ''}</div>`
            : html`<div style="margin-top:12px">
                <button class="btn primary" data-resolve-error="${row.id}">رسیدگی شد</button>
                <div class="hint" style="margin-top:6px">
                  اگر دوباره اتفاق بیفتد خودش برمی‌گردد — «رسیدگی شد» ادعایی درباره‌ی رفع است و سامانه بررسی‌اش می‌کند.
                </div>
              </div>`
        }`,
    });
  } catch (err) {
    toast(err.message, 'danger');
  }
}

async function resolveError(id) {
  try {
    await systemLog.resolve(id, '');
    toast('علامت خورد');
    await resolve();
  } catch (err) {
    toast(err.message, 'danger');
  }
}

async function sendTestAlert() {
  try {
    const res = await systemLog.testAlert();
    toast(res.sent ? 'پیام آزمایشی فرستاده شد' : res.reason || 'کانال هشدار تنظیم نشده', res.sent ? 'ok' : 'danger');
  } catch (err) {
    toast(err.message, 'danger');
  }
}

/** Clicks belonging to this screen. Returns true when it handled one. */
export function handleSystemLogClick(d, el) {
  if (d.error) {
    showErrorDetail(d.error);
    return true;
  }
  if (d.resolveError) {
    resolveError(d.resolveError);
    return true;
  }
  if (el?.hasAttribute?.('data-test-alert')) {
    sendTestAlert();
    return true;
  }
  return false;
}
