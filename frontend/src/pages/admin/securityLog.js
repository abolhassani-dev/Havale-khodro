import { html } from '../../ui/html.js';
import { icon } from '../../ui/icons.js';
import { security } from '../../api/index.js';
import { getState } from '../../state/store.js';
import { faDigits, dateTime, relative } from '../../ui/format.js';
import { emptyBox, toast, openModal, qtip } from '../../ui/feedback.js';
import { resolve } from '../../router.js';

/**
 * Who tried to break in, and what they tried.
 *
 * ── What this page is claiming, and what it is not ──────────────────────────
 *
 * It is not claiming the system is under attack, and it is not claiming an
 * attack succeeded. Every row here is an attempt that the ordinary defences
 * refused on their own: queries are parameterised, output is escaped, unknown
 * fields are stripped. What was missing was the *knowing*, and a system that is
 * probed and cannot say so is not secure — it is unaware.
 *
 * So the tone of the screen matters. An empty list is good news and says so. A
 * row is a fact with numbers behind it, not an alarm, and each one carries a
 * plain sentence about what the attempt was and why it did not work.
 *
 * ── The one destructive control ─────────────────────────────────────────────
 *
 * Blocking an address. It is manual for a reason spelled out in the middleware:
 * the address arrives in a header the client controls, so a system that blocks
 * by itself can be made to lock out real agencies. The screen shows the reader
 * their own address beside the button, because the one mistake this button can
 * make is locking the door from the inside.
 */

const SEVERITY = {
  high: { label: 'جدی', tone: 'r' },
  medium: { label: 'متوسط', tone: 'w' },
  low: { label: 'کم', tone: 'n' },
};

export async function loadSecurityLog(params) {
  return {
    security: await security.events({
      resolved: params.tab === 'resolved',
      rule: params.rule,
      severity: params.severity,
      take: 50,
    }),
  };
}

export function securityLogPage() {
  const { data, params } = getState();
  const d = data.security || {};
  const items = d.items || [];
  const resolvedTab = params.tab === 'resolved';

  return html`
  <div class="card">
    <div class="card-h">
      <h2>
        لاگ امنیتی
        ${qtip('هر تلاش برای نفوذ که سامانه تشخیص داده — تزریق SQL، اسکریپت، خواندن فایل‌های سرور، اسکن خودکار و حدس رمز. هیچ‌کدام از این‌ها موفق نمی‌شوند؛ این فهرست برای این است که بدانید چه کسی امتحان کرده. رویدادهای یکسان از یک آی‌پی روی یک ردیف جمع می‌شوند.')}
      </h2>
      <div class="tabs">
        <button class="tab ${resolvedTab ? '' : 'on'}" data-go="adm-security">باز</button>
        <button class="tab ${resolvedTab ? 'on' : ''}" data-go="adm-security" data-go-params="tab=resolved">بررسی‌شده</button>
      </div>
      ${severityChips(d.summary || {}, params)}
    </div>

    ${
      params.rule || params.severity
        ? html`<div class="hint tl-filter">
            فیلتر فعال است.
            <button class="btn sm" data-go="adm-security">نمایش همه</button>
          </div>`
        : ''
    }

    ${
      items.length
        ? html`<div class="elog">${items.map(eventRow)}</div>`
        : emptyBox(
            resolvedTab
              ? 'چیزی به‌عنوان بررسی‌شده علامت نخورده.'
              : 'هیچ تلاش نفوذی ثبت نشده. این خبر خوبی است.'
          )
    }
  </div>

  ${blockedCard(d.blocked || [], d.yourIp)}`;
}

/** Three numbers that are also the filter. Counting and choosing are one act. */
function severityChips(summary, params) {
  return html`<div class="sev-chips">
    ${['high', 'medium', 'low'].map(
      (key) => html`<button class="sev-chip is-${SEVERITY[key].tone} ${params.severity === key ? 'on' : ''}"
        data-go="adm-security" data-go-params="severity=${key}">
        <b class="num">${faDigits(summary[key] || 0)}</b> ${SEVERITY[key].label}
      </button>`
    )}
  </div>`;
}

function eventRow(row) {
  const sev = SEVERITY[row.severity] || SEVERITY.medium;
  return html`<div class="elog-row" data-sec-event="${row.id}">
    <span class="elog-i is-${sev.tone}">${icon('shield', 15)}</span>
    <div class="elog-b">
      <div class="elog-t">
        ${row.label}
        <span class="sec-ip is-tech">${row.ip}</span>
      </div>
      <div class="elog-m">
        ${row.path ? html`<span class="is-tech">${row.method || ''} ${row.path}</span> · ` : ''}
        آخرین بار ${relative(row.lastSeen)}
        ${row.user ? html` · حساب: ${row.user.agencyName || row.user.username}` : ''}
      </div>
    </div>
    <span class="tag ${sev.tone} num">${faDigits(row.count)}×</span>
    <span class="tl-chev">${icon('chevron', 14)}</span>
  </div>`;
}

function blockedCard(blocked, yourIp) {
  return html`
  <div class="card">
    <div class="card-h">
      <h2>آی‌پی‌های بسته‌شده ${qtip('بستن همیشه دستی است. اگر سامانه خودش می‌بست، کسی که هدر آی‌پی را جعل کند می‌توانست نمایندگی‌های واقعی را از سامانه بیرون بیندازد — یعنی ابزار دفاع، خودش سلاح حمله می‌شد.')}</h2>
      ${yourIp ? html`<span class="tag">آی‌پی خود شما: <b class="is-tech">${yourIp}</b></span>` : ''}
    </div>
    ${
      blocked.length
        ? html`<div class="elog">
            ${blocked.map(
              (b) => html`<div class="elog-row">
                <span class="elog-i is-r">${icon('shield', 15)}</span>
                <div class="elog-b">
                  <div class="elog-t is-tech">${b.ip}</div>
                  <div class="elog-m">
                    ${b.reason || 'بدون توضیح'}
                    · ${b.until ? html`تا ${dateTime(b.until)}` : 'بدون مهلت'}
                  </div>
                </div>
                <button class="btn sm" data-unblock="${b.ip}">باز کردن</button>
              </div>`
            )}
          </div>`
        : emptyBox('هیچ آی‌پی‌ای بسته نشده.')
    }
  </div>`;
}

export async function showSecurityEvent(id) {
  try {
    const row = await security.event(id);
    const sev = SEVERITY[row.severity] || SEVERITY.medium;

    openModal({
      type: 'info',
      wide: true,
      title: row.label,
      body: html`
        <div class="drow"><span>شدت</span><b><span class="tag ${sev.tone}">${sev.label}</span></b></div>
        <div class="drow"><span>آی‌پی</span><b class="is-tech">${row.ip}</b></div>
        <div class="drow"><span>تعداد تلاش</span><b class="num">${faDigits(row.count)} بار</b></div>
        <div class="drow"><span>اولین بار</span><b>${dateTime(row.firstSeen)}</b></div>
        <div class="drow"><span>آخرین بار</span><b>${dateTime(row.lastSeen)}</b></div>
        ${row.path ? html`<div class="drow"><span>مسیر</span><b class="is-tech">${row.method || ''} ${row.path}</b></div>` : ''}
        ${row.user ? html`<div class="drow"><span>حساب</span><b>${row.user.agencyName || row.user.username}</b></div>` : ''}
        ${row.userAgent ? html`<div class="drow"><span>دستگاه</span><b class="is-tech">${row.userAgent}</b></div>` : ''}

        ${
          // The payload itself. Rendered as text through the escaping tag, so a
          // stored script tag is shown rather than run — this page displays
          // things whose entire purpose is to execute.
          row.sample
            ? html`<div class="sec-sample">
                <div class="chg-h">چه چیزی فرستاده شده</div>
                <pre class="elog-stack">${row.sample}</pre>
              </div>`
            : ''
        }

        ${row.help ? html`<div class="elog-help">${icon('shield', 15)}<div>${row.help}</div></div>` : ''}

        ${
          row.alsoFrom?.length
            ? html`<div class="sec-also">
                <div class="chg-h">همین آی‌پی چه چیز دیگری امتحان کرده</div>
                ${row.alsoFrom.map(
                  (o) => html`<div class="sec-also-row">
                    <span class="tag ${(SEVERITY[o.severity] || SEVERITY.medium).tone}">${o.label}</span>
                    <span class="num">${faDigits(o.count)}×</span>
                    <span class="sub">${relative(o.lastSeen)}</span>
                  </div>`
                )}
              </div>`
            : ''
        }

        <div class="sec-actions">
          ${
            row.resolvedAt
              ? html`<div class="hint">بررسی‌شده در ${dateTime(row.resolvedAt)}</div>`
              : html`<button class="btn" data-sec-resolve="${row.id}">بررسی شد</button>`
          }
          ${
            row.blocked
              ? html`<button class="btn" data-unblock="${row.ip}">باز کردن آی‌پی</button>`
              : html`<button class="btn danger" data-block="${row.ip}">بستن این آی‌پی</button>`
          }
        </div>
        <div class="hint" style="margin-top:8px">
          «بررسی شد» ادعایی درباره‌ی رسیدگی است و سامانه بررسی‌اش می‌کند — اگر همان آی‌پی
          دوباره تلاش کند، ردیف خودش برمی‌گردد.
        </div>`,
    });
  } catch (err) {
    toast(err.message, 'danger');
  }
}

function blockModal(ip) {
  openModal({
    type: 'form',
    title: 'بستن آی‌پی',
    body: html`
      <p>دسترسی <b class="is-tech">${ip}</b> به کل سامانه بسته می‌شود.</p>
      <div class="field">
        <label for="reason">دلیل <span class="opt">(اختیاری)</span></label>
        <input class="in" id="reason" name="reason" maxlength="200" placeholder="مثلاً اسکن مداوم">
      </div>
      <div class="field">
        <label for="days">مدت</label>
        <select class="in" id="days" name="days">
          <option value="7">۷ روز</option>
          <option value="30" selected>۳۰ روز</option>
          <option value="365">یک سال</option>
          <option value="">بدون مهلت</option>
        </select>
        <div class="hint">
          آی‌پی اجاره‌ای است و سال دیگر دست کس دیگری است — به همین دلیل «بدون مهلت»
          پیش‌فرض نیست. تا یک دقیقه طول می‌کشد تا اثر کند.
        </div>
      </div>`,
    confirmLabel: 'ببند',
    onSubmit: async (form) => {
      await security.block({
        ip,
        reason: form.reason.value || null,
        days: form.days.value ? Number(form.days.value) : null,
      });
      toast('آی‌پی بسته شد');
      await resolve();
    },
  });
}

async function unblock(ip) {
  try {
    await security.unblock(ip);
    toast('آی‌پی باز شد');
    await resolve();
  } catch (err) {
    toast(err.message, 'danger');
  }
}

async function markResolved(id) {
  try {
    await security.resolve(id, '');
    toast('علامت خورد');
    await resolve();
  } catch (err) {
    toast(err.message, 'danger');
  }
}

/** Clicks belonging to this screen. Returns true when it handled one. */
export function handleSecurityClick(d) {
  if (d.secEvent) {
    showSecurityEvent(d.secEvent);
    return true;
  }
  if (d.secResolve) {
    markResolved(d.secResolve);
    return true;
  }
  if (d.block) {
    blockModal(d.block);
    return true;
  }
  if (d.unblock) {
    unblock(d.unblock);
    return true;
  }
  return false;
}
