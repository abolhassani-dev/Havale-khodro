import { html, raw } from '../../ui/html.js';
import { havale, registration, subscription, reports, tickets } from '../../api/index.js';
import { getState } from '../../state/store.js';
import { num, faDigits, date, until } from '../../ui/format.js';
import { emptyBox, qtip } from '../../ui/feedback.js';

export async function loadDashboard() {
  // A reseller's dashboard covers the family: its own listings and its
  // sub-agencies', in one view — the parent's job is knowing what its
  // agencies are working on.
  const reseller = Boolean(getState().user?.isReseller);

  // Fetched together rather than in sequence: the dashboard is the first screen
  // after sign-in, and four round trips one after another is a visible pause.
  const scope = reseller ? { scope: 'all' } : {};
  const [havales, registrations, usage, sub, strikes, ticketList, seatAlerts] = await Promise.all([
    havale.mine({ limit: 50, ...scope }),
    // Every market this agency can post in, not only حواله. The dashboard says
    // «آگهی‌ها» and it has to mean it: a ثبت‌نامی advertisement expiring
    // tomorrow belongs in «به‌زودی منقضی می‌شوند» exactly as much as a حواله
    // does, and a heading that quietly covers one market is worse than one that
    // admits it covers one.
    //
    // Caught rather than awaited bare: this is the first screen after sign-in
    // and a market being briefly unavailable must dim one card, not the page.
    registration.mine({ limit: 50, ...scope }).catch(() => ({ items: [] })),
    havale.usage(),
    subscription.me(),
    reports.againstMe(),
    tickets.list(),
    reseller ? subscription.seatAlerts().catch(() => []) : [],
  ]);

  // Merged and re-sorted, so «آخرین» means the six most recent things this
  // agency did — not the six most recent حواله with ثبت‌نامی hidden behind them.
  const items = [
    ...(havales.items || []).map((row) => ({ ...row, market: 'HAVALE' })),
    ...(registrations.items || []).map((row) => ({ ...row, market: 'REGISTRATION' })),
  ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return { mine: { items }, usage, sub, strikes, tickets: ticketList, seatAlerts };
}

/**
 * Which market a row belongs to, for the badge on the dashboard.
 *
 * Two markets today and more coming, so the label is looked up rather than
 * written into the row — see marketRegistry on the server for the same idea in
 * the other direction.
 */
const MARKET_LABEL = { HAVALE: 'حواله', REGISTRATION: 'ثبت‌نامی', CAR: 'خودرو' };
const MARKET_TONE = { HAVALE: '', REGISTRATION: 'c', CAR: 'b' };

/** A decided capacity order the buyer has not dismissed — shown until they do. */
function seatAlertBanner(order) {
  const approved = order.status === 'PAID';
  return html`<div class="banner ${approved ? 'ok' : 'danger'}">
    <span class="b-ico">${approved ? '✓' : '✕'}</span>
    <div class="b-txt">
      <b>درخواست ظرفیت #${faDigits(order.serial)} (${faDigits(order.seats)} ظرفیت)
        ${approved ? 'تأیید شد' : 'رد شد'}</b>
      ${approved ? 'ظرفیت به حساب شما اضافه شد و می‌توانید زیرنماینده بسازید.' : ''}
      ${order.adminNote ? html` توضیح: ${order.adminNote}` : ''}
    </div>
    <button class="btn sm" data-ack-seat="${order.id}">متوجه شدم</button>
  </div>`;
}

export function dashboardPage() {
  const { data, user } = getState();
  const { mine, usage, sub, strikes, tickets: ticketList } = data;
  const reseller = Boolean(user?.isReseller);

  const items = mine?.items || [];
  const active = items.filter((h) => h.status === 'ACTIVE');
  const closingSoon = active
    .filter((h) => h.closesAt && new Date(h.closesAt) - Date.now() < 3 * 24 * 60 * 60 * 1000)
    .sort((a, b) => new Date(a.closesAt) - new Date(b.closesAt));

  const totalReveals = items.reduce((sum, h) => sum + (h.revealCount || 0), 0);
  const openTickets = (ticketList || []).filter((t) => t.status !== 'CLOSED');

  return html`
  ${(data.seatAlerts || []).map(seatAlertBanner)}

  <div class="stats">
    ${stat('آگهی فعال', num(active.length), reseller ? `کل مجموعه — از ${faDigits(items.length)} آگهی` : `از ${faDigits(items.length)} آگهی`)}
    ${stat('بازدید مشخصات', num(totalReveals), 'مجموع روی آگهی‌های شما')}
    ${stat(
      'سقف امروز',
      `${faDigits(usage?.dailyUsed ?? 0)} / ${faDigits(usage?.dailyLimit ?? 0)}`,
      `این دوره: ${faDigits(usage?.monthlyUsed ?? 0)} از ${faDigits(usage?.monthlyLimit ?? 0)}`
    )}
    ${
      // A sub-agency's access rides on the parent's subscription: no dates, no
      // day counts, no renewal — only whether the account works right now.
      user?.parentId
        ? stat(
            'دسترسی',
            sub?.active ? 'فعال' : 'غیرفعال',
            sub?.active ? 'زیرمجموعه‌ی نمایندگی مرکزی' : 'با نمایندگی مرکزی هماهنگ کنید'
          )
        : sub?.suspended
          ? // Not «منقضی», and above all not «برای ادامه تمدید کنید» — paying
            // would change nothing, and sending them to the payment page for a
            // penalty is taking money for a door that stays shut.
            stat('وضعیت حساب', 'تعلیق‌شده', 'برای رفع تعلیق، اعتراض ثبت کنید')
          : stat(
              'اشتراک',
              sub?.active ? `${faDigits(sub.daysLeft)} روز` : 'منقضی',
              sub?.active ? `تا ${date(sub.expiresAt)}` : 'برای ادامه تمدید کنید'
            )
    }
  </div>

  ${
    closingSoon.length
      ? html`<div class="card">
          <div class="card-h">
            <h2>آگهی‌هایی که به‌زودی منقضی می‌شوند ${qtip('آگهی‌های فعال شما که مهلتشان رو به پایان است. با دکمه‌ی «تمدید»، آگهی هفت روز دیگر فعال می‌ماند؛ اگر تمدید نکنید، بعد از پایان مهلت از استعلام دیگران حذف می‌شود.')}</h2>
            <span class="tag w">${faDigits(closingSoon.length)} مورد</span>
          </div>
          <table>
            <thead><tr><th>خودرو</th><th>بازار</th><th>مهلت</th><th></th></tr></thead>
            <tbody>
              ${closingSoon.slice(0, 5).map(
                (h) => html`<tr>
                  <td>${h.carType}</td>
                  <td><span class="tag ${MARKET_TONE[h.market] || 'c'}">${MARKET_LABEL[h.market] || '—'}</span></td>
                  <td><span class="tag w">${until(h.closesAt)}</span></td>
                  <td style="text-align:left">
                    ${
                      // Each market renews through its own module. One button
                      // calling the حواله endpoint for all three would 404 on
                      // the rest — silently, since a failed renewal looks like
                      // a click that did nothing.
                      h.market === 'HAVALE'
                        ? html`<button class="btn sm" data-renew="${h.id}">تمدید</button>`
                        : h.market === 'CAR'
                          ? html`<button class="btn sm" data-car-renew="${h.id}">تمدید</button>`
                          : html`<button class="btn sm" data-reg-renew="${h.id}" data-reg-kind="${h.kind}">تمدید</button>`
                    }
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
      <div class="card-h"><h2>${reseller ? 'آخرین آگهی‌های مجموعه' : 'آخرین آگهی‌های من'} ${qtip(reseller ? 'آخرین آگهی‌های شما و زیرنمایندگی‌هایتان. ستون «زیرشاخه» می‌گوید آگهی مال کدام حساب است. با کلیک روی هر ردیف جزئیات باز می‌شود.' : 'آخرین آگهی‌های خودتان. ستون «بازدید» یعنی چند نمایندگی مشخصات تماس شما را روی آن آگهی دیده‌اند. با کلیک روی هر ردیف جزئیات باز می‌شود.')}</h2>
        <button class="btn sm" data-go="mine">همه</button></div>
      ${
        items.length
          ? html`<table>
              <thead><tr><th>خودرو</th><th>بازار</th>${reseller ? html`<th>زیرشاخه</th>` : ''}<th>وضعیت</th><th>بازدید</th></tr></thead>
              <tbody>
                ${items.slice(0, 6).map(
                  (h) => html`<tr ${raw(h.market === 'HAVALE' ? `data-open-havale="${h.id}"` : h.market === 'CAR' ? `data-open-car="${h.id}"` : '')} style="cursor:pointer">
                    <td>${h.carType}</td>
                    <td><span class="tag ${MARKET_TONE[h.market] || 'c'}">${MARKET_LABEL[h.market] || '—'}</span></td>
                    ${
                      reseller
                        ? html`<td>${h.isOwn ? html`<span class="tag b">خودم</span>` : html`<span class="num">${h.agency?.code || '—'}</span>`}</td>`
                        : ''
                    }
                    <td>${statusTag(h)}</td>
                    <td class="num">${faDigits(h.revealCount || 0)}</td>
                  </tr>`
                )}
              </tbody>
            </table>`
          : emptyBox('هنوز آگهی‌ای ثبت نکرده‌اید.')
      }
    </div>

    <div class="card">
      <div class="card-h"><h2>وضعیت حساب ${qtip('اخطارهای تأییدشده و مشخصات نمایندگی شما. اگر اخطارها به سقف برسد، حساب به‌طور خودکار تعلیق می‌شود؛ اگر به اخطاری اعتراض دارید از بخش پشتیبانی تیکت بزنید.')}</h2></div>
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
