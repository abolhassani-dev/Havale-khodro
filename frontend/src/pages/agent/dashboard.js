import { html } from '../../ui/html.js';
import { havale, subscription, reports, tickets } from '../../api/index.js';
import { getState } from '../../state/store.js';
import { num, faDigits, date, until, KIND_LABEL } from '../../ui/format.js';
import { emptyBox } from '../../ui/feedback.js';

export async function loadDashboard() {
  // Fetched together rather than in sequence: the dashboard is the first screen
  // after sign-in, and four round trips one after another is a visible pause.
  const [mine, usage, sub, strikes, ticketList] = await Promise.all([
    havale.mine({ limit: 50 }),
    havale.usage(),
    subscription.me(),
    reports.againstMe(),
    tickets.list(),
  ]);

  return { mine, usage, sub, strikes, tickets: ticketList };
}

export function dashboardPage() {
  const { data, user } = getState();
  const { mine, usage, sub, strikes, tickets: ticketList } = data;

  const items = mine?.items || [];
  const active = items.filter((h) => h.status === 'ACTIVE');
  const closingSoon = active
    .filter((h) => h.closesAt && new Date(h.closesAt) - Date.now() < 3 * 24 * 60 * 60 * 1000)
    .sort((a, b) => new Date(a.closesAt) - new Date(b.closesAt));

  const totalReveals = items.reduce((sum, h) => sum + (h.revealCount || 0), 0);
  const openTickets = (ticketList || []).filter((t) => t.status !== 'CLOSED');

  return html`
  <div class="stats">
    ${stat('آگهی فعال', num(active.length), `از ${faDigits(items.length)} حواله`)}
    ${stat('بازدید مشخصات', num(totalReveals), 'مجموع روی آگهی‌های شما')}
    ${stat(
      'سقف امروز',
      `${faDigits(usage?.dailyUsed ?? 0)} / ${faDigits(usage?.dailyLimit ?? 0)}`,
      `این دوره: ${faDigits(usage?.monthlyUsed ?? 0)} از ${faDigits(usage?.monthlyLimit ?? 0)}`
    )}
    ${stat(
      'اشتراک',
      sub?.active ? `${faDigits(sub.daysLeft)} روز` : 'منقضی',
      sub?.active ? `تا ${date(sub.expiresAt)}` : 'برای ادامه تمدید کنید'
    )}
  </div>

  ${
    closingSoon.length
      ? html`<div class="card">
          <div class="card-h">
            <h2>آگهی‌هایی که به‌زودی بسته می‌شوند</h2>
            <span class="tag w">${faDigits(closingSoon.length)} مورد</span>
          </div>
          <table>
            <thead><tr><th>خودرو</th><th>نوع</th><th>مهلت</th><th></th></tr></thead>
            <tbody>
              ${closingSoon.slice(0, 5).map(
                (h) => html`<tr>
                  <td>${h.carType}</td>
                  <td>${KIND_LABEL[h.kind]}</td>
                  <td><span class="tag w">${until(h.closesAt)}</span></td>
                  <td style="text-align:left">
                    <button class="btn sm" data-renew="${h.id}">تمدید</button>
                  </td>
                </tr>`
              )}
            </tbody>
          </table>
        </div>`
      : ''
  }

  <div class="cols c3">
    <div class="card">
      <div class="card-h"><h2>آخرین حواله‌های من</h2>
        <button class="btn sm" data-go="mine">همه</button></div>
      ${
        items.length
          ? html`<table>
              <thead><tr><th>خودرو</th><th>وضعیت</th><th>بازدید</th></tr></thead>
              <tbody>
                ${items.slice(0, 6).map(
                  (h) => html`<tr data-open-havale="${h.id}" style="cursor:pointer">
                    <td>${h.carType}</td>
                    <td>${statusTag(h)}</td>
                    <td class="num">${faDigits(h.revealCount || 0)}</td>
                  </tr>`
                )}
              </tbody>
            </table>`
          : emptyBox('هنوز حواله‌ای ثبت نکرده‌اید.')
      }
    </div>

    <div class="card">
      <div class="card-h"><h2>وضعیت حساب</h2></div>
      <div style="padding:12px 14px">
        ${
          strikes?.strikes
            ? html`<div class="banner danger">
                <span class="b-ico">⚑</span>
                <div class="b-txt">
                  <b>${faDigits(strikes.strikes)} اخطار تأییدشده از ${faDigits(strikes.limit)}</b>
                  با رسیدن به ${faDigits(strikes.limit)} اخطار، حساب تعلیق می‌شود.
                  اگر اعتراضی دارید از بخش پشتیبانی تیکت بزنید.
                </div>
              </div>`
            : html`<div class="banner ok">
                <span class="b-ico">✓</span>
                <div class="b-txt">هیچ اخطار تأییدشده‌ای روی حساب شما نیست.</div>
              </div>`
        }
        <div class="drow"><span>کد نمایندگی</span><b>${user?.agency?.code || '—'}</b></div>
        <div class="drow"><span>شهر</span><b>${user?.agency?.city || '—'}</b></div>
        <div class="drow"><span>تیکت باز</span><b>${faDigits(openTickets.length)}</b></div>
      </div>
    </div>
  </div>`;
}

function stat(label, value, hint) {
  return html`<div class="stat">
    <div class="s-l">${label}</div>
    <div class="s-v num">${value}</div>
    <div class="s-h">${hint}</div>
  </div>`;
}

function statusTag(h) {
  if (h.status === 'ACTIVE') {
    const dead = h.closesAt && new Date(h.closesAt) < Date.now();
    return dead
      ? html`<span class="tag">مهلت تمام شده</span>`
      : html`<span class="tag g">فعال</span>`;
  }
  if (h.status === 'FULFILLED') return html`<span class="tag">فروخته شد</span>`;
  if (h.status === 'SUSPENDED') return html`<span class="tag r">تعلیق‌شده</span>`;
  return html`<span class="tag">${h.status}</span>`;
}
