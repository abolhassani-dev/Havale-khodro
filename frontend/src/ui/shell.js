import { html, raw } from './html.js';
import { icon } from './icons.js';
import { getState, isAdmin, isAgent, can } from '../state/store.js';
import { date, faDigits } from './format.js';
import { BRAND } from '../constants.js';

/**
 * The frame every page sits in: sidebar, top bar, and the expired-subscription
 * banner.
 */

/**
 * The agent menu: the dashboard on its own, then five collapsible sections.
 *
 * Four of the five are one market each — حواله today, and خودرو, ثبت‌نامی and
 * قطعات as they arrive. They are in the menu before they work on purpose: an
 * agency that can see where car sales will live stops asking whether the
 * product does them, and each item explains itself when opened rather than
 * being a dead link. `soon` is what marks a section as not yet built; nothing
 * else in the file needs to know which ones those are.
 */
const AGENT_NAV = [
  { page: 'dash', icon: 'dashboard', label: 'داشبورد' },

  {
    id: 'havale',
    // Open on arrival. It is the section that works today, and a sidebar whose
    // every group is shut asks the reader to go hunting before they can do the
    // thing they signed in to do.
    defaultOpen: true,
    icon: 'file',
    label: 'حواله',
    children: [
      { page: 'search', icon: 'search', label: 'استعلام حواله‌ها' },
      { page: 'new-offer', icon: 'plus', label: 'ثبت حواله جدید' },
      { page: 'new-request', icon: 'inbox', label: 'ثبت درخواست خرید' },
      { page: 'mine', icon: 'list', label: 'حواله‌های من' },
    ],
  },

  {
    id: 'car',
    icon: 'car',
    label: 'خودرو',
    soon: true,
    children: [
      { page: 'car-search', icon: 'search', label: 'استعلام خودرو' },
      { page: 'car-sell', icon: 'plus', label: 'ثبت آگهی فروش' },
      { page: 'car-buy', icon: 'inbox', label: 'ثبت درخواست خرید' },
      { page: 'car-mine', icon: 'list', label: 'آگهی‌های من' },
    ],
  },

  {
    id: 'reg',
    icon: 'clipboard',
    label: 'ثبت‌نامی',
    children: [
      { page: 'reg-search', icon: 'search', label: 'استعلام ثبت‌نامی' },
      { page: 'reg-offer', icon: 'inbox', label: 'اعلام ظرفیت ثبت‌نام' },
      { page: 'reg-request', icon: 'plus', label: 'ثبت درخواست ثبت‌نام' },
      { page: 'reg-mine', icon: 'list', label: 'ثبت‌نامی‌های من' },
    ],
  },

  {
    id: 'parts',
    icon: 'wrench',
    label: 'قطعات',
    soon: true,
    children: [
      { page: 'parts-search', icon: 'search', label: 'استعلام قطعات' },
      { page: 'parts-offer', icon: 'plus', label: 'ثبت آگهی قطعه' },
      { page: 'parts-request', icon: 'inbox', label: 'ثبت درخواست قطعه' },
      { page: 'parts-mine', icon: 'list', label: 'آگهی‌های من' },
    ],
  },

  {
    id: 'profile',
    icon: 'user',
    label: 'پروفایل کاربری',
    children: [
      { page: 'profile', icon: 'settings', label: 'تنظیمات حساب' },
      // A sub-agency's access rides on the parent's subscription. The page
      // would show dates and invoices that are not theirs to act on, so for
      // them it simply is not in the menu.
      { page: 'subscription', icon: 'clock', label: 'اشتراک من', notForSubagent: true },
      { page: 'sub-agents', icon: 'users', label: 'زیرنمایندگی‌ها', needsReseller: true },
      { page: 'tickets', icon: 'mail', label: 'پشتیبانی' },
    ],
  },
];

/** Every page that lives under a section, so the section can open itself. */
export function sectionOf(page) {
  const section = AGENT_NAV.find((item) => item.children?.some((c) => c.page === page));
  return section?.id || null;
}

/** The sections that are placeholders, and the pages inside them. */
export const SOON_PAGES = new Map(
  AGENT_NAV.filter((item) => item.soon).flatMap((section) =>
    section.children.map((child) => [child.page, { section, child }])
  )
);

/**
 * The admin menu, grouped by what the reader is trying to do.
 *
 * The headings are the part that has to be right: a heading is a promise about
 * what is under it. «محتوا» over the car catalogue and the violation reports
 * was not one — a violation report is not content, it is a complaint about a
 * listing, and it belongs beside the listings it is about. So each heading now
 * names the thing its items act on: the agencies, the listings, the people
 * asking us for something, and the system itself.
 */
const ADMIN_NAV = [
  { group: 'مرور کلی' },
  { page: 'adm-dash', icon: 'dashboard', label: 'داشبورد', permission: 'monitoring' },
  { page: 'adm-monitor', icon: 'eye', label: 'مانیتورینگ', permission: 'monitoring' },
  { group: 'نمایندگی‌ها' },
  { page: 'adm-agents', icon: 'shield', label: 'فهرست نمایندگی‌ها', permission: 'agents' },
  { page: 'adm-new-agent', icon: 'plus', label: 'ساخت نمایندگی', permission: 'agents' },
  { group: 'آگهی‌ها' },
  // One entry per market. They share the moderation code but not the screen:
  // somebody sent to look at a ثبت‌نامی complaint should not have to filter
  // حواله rows out of the way first.
  { page: 'adm-havales', icon: 'file', label: 'مدیریت حواله‌ها', permission: 'listings' },
  { page: 'adm-registrations', icon: 'clipboard', label: 'مدیریت ثبت‌نامی‌ها', permission: 'listings' },
  // A report is a complaint about a listing, so it sits with the listings
  // rather than under a heading of its own.
  { page: 'adm-reports', icon: 'flag', label: 'گزارش تخلف', permission: 'reports' },
  { page: 'adm-catalog', icon: 'car', label: 'کاتالوگ خودرو', permission: 'catalog' },
  { group: 'پشتیبانی' },
  // Both halves of «somebody is asking us for something» sit together: a
  // conversation and a capacity request are the same job from the desk that
  // answers them.
  { page: 'adm-tickets', icon: 'ticket', label: 'گفتگوها', permission: 'tickets' },
  { page: 'adm-seats', icon: 'layers', label: 'درخواست ظرفیت', permission: 'seats' },
  { group: 'سامانه' },
  { page: 'adm-settings', icon: 'settings', label: 'تنظیمات', permission: 'settings' },
  // Behind `errorLog`, which the permissions table gives to the owner alone. It
  // therefore never appears for a super admin — and because a heading is only
  // drawn when something follows it, «سامانه» does not announce a section
  // nobody else can reach either.
  { page: 'adm-errors', icon: 'wrench', label: 'لاگ فنی', permission: 'errorLog' },
  { page: 'adm-security', icon: 'shield', label: 'لاگ امنیتی', permission: 'errorLog' },
  { page: 'adm-staff', icon: 'users', label: 'کاربران سیستم', permission: 'staff' },
];

/**
 * The admin menu as this account sees it.
 *
 * Two passes, because one is not enough. The first drops items the account has
 * no permission for; the second drops any heading left standing over nothing.
 *
 * The second pass is not decoration. A heading with no items under it announces
 * a part of the system the reader cannot reach — and the rule was first written
 * for a heading named «مالک», which announced the one account the whole design
 * exists to keep quiet. That one was fixed by giving the heading a permission
 * of its own, which left the other headings hanging empty over a support
 * account, as a real sign-in showed. Per-account ticks make that the ordinary
 * case rather than the odd one, so the rule is general: a heading is shown when
 * something follows it. (The owner's page now sits under «سامانه», so no
 * heading names that account either.)
 */
export function adminMenu() {
  const allowed = ADMIN_NAV.filter((item) => (item.permission ? can(item.permission) : true));

  return allowed.filter(
    (item, i) => !item.group || (allowed[i + 1] && !allowed[i + 1].group)
  );
}

/**
 * Where an administrator lands.
 *
 * The dashboard, when they can open it — and otherwise the first thing in their
 * menu that they can. Sending everybody to the dashboard meant a finance or
 * support account, and now anybody whose `monitoring` box is unticked, opened
 * the panel onto a refusal. Null when the account can reach nothing at all.
 */
export function adminHome() {
  return adminMenu().find((item) => item.page)?.page || null;
}

// Which sidebar entries wear a number, and which count they wear. The counts
// arrive with every navigation; a missing or null count simply shows nothing.
const NAV_BADGE = { 'adm-tickets': 'openTickets', 'adm-seats': 'pendingSeatOrders' };

function link(item, current) {
  const badgeKey = NAV_BADGE[item.page];
  const count = badgeKey ? getState().badges?.[badgeKey] : null;
  return html`<a class="${item.page === current ? 'on' : ''}" data-go="${item.page}">
    <span class="ico">${icon(item.icon)}</span>${item.label}
    ${count ? html`<span class="nav-badge num">${faDigits(count)}</span>` : ''}
  </a>`;
}

/** Hides entries the account cannot use, so no menu item answers "not for you". */
function visible(children, user) {
  return children.filter((child) => {
    if (child.needsReseller && !user?.isReseller) return false;
    if (child.notForSubagent && user?.parentId) return false;
    return true;
  });
}

function navSection(section, current, openIds, user) {
  const children = visible(section.children, user);
  if (!children.length) return raw('');

  // A section holding the current page is open whether or not the reader has
  // touched it — otherwise arriving by a link or a refresh would leave the
  // highlighted item inside a collapsed group, invisible.
  //
  // `openNav` records every section the reader has toggled, so a default-open
  // section that they closed appears in the list and must count as closed.
  const touched = openIds.includes(section.id);
  const open =
    children.some((c) => c.page === current) ||
    (section.defaultOpen ? !touched : touched);

  return html`
  <div class="navsec ${open ? 'open' : ''}">
    <button class="sechead" data-nav-section="${section.id}"
            aria-expanded="${open ? 'true' : 'false'}">
      <span class="ico">${icon(section.icon)}</span>
      <span class="lbl">${section.label}</span>
      ${section.soon ? html`<span class="soon">به‌زودی</span>` : ''}
      <span class="chev">${icon('chevron', 15)}</span>
    </button>
    <div class="secbody">${children.map((child) => link(child, current))}</div>
  </div>`;
}

function adminItem(item, current) {
  if (item.group) return html`<div class="group">${item.group}</div>`;
  return link(item, current);
}

export function sidebar() {
  const s = getState();
  const admin = isAdmin();
  const agent = isAgent();

  // Three cases, not two. An account that is neither gets an empty menu rather
  // than the agency one — which is what `!admin` used to give it, complete with
  // «حواله‌های من» for a user that has no agency behind it.
  // The destination, not the page still on screen: a click has to light up the
  // item it was aimed at immediately, or the menu looks unresponsive for as
  // long as the next page takes to load.
  const here = s.navigating || s.page;

  const body = admin
    ? adminMenu().map((item) => adminItem(item, here))
    : agent
      ? AGENT_NAV.map((item) =>
          item.children
            ? navSection(item, here, s.openNav || [], s.user)
            : link(item, here)
        )
      : raw('');

  const footer = agent
    ? html`<b>${s.user?.agency?.code || ''}</b>${s.user?.agency?.name || ''} — ${s.user?.agency?.city || ''}`
    : html`<b>${s.user?.fullName || ''}</b>${roleLabel(s.user?.role)}`;

  return html`
  <aside class="sidebar ${s.sidebarOpen ? 'show' : ''}" id="sb">
    <div class="brand">
      <div class="mark"><img src="/assets/logo.svg" alt=""> ${BRAND.nameFa}</div>
      <div class="sub">${agent ? 'پنل نمایندگی‌ها' : 'پنل مدیریت'}</div>
      <!-- Phone only. The button that opens this menu is in the top bar, which
           the open menu covers — so without a way out from inside, the drawer
           was a one-way door. -->
      <button class="sb-close" data-toggle-sidebar aria-label="بستن منو">${icon('close', 18)}</button>
    </div>
    <nav class="nav">${body}</nav>
    <div class="sidefoot">${footer}</div>
  </aside>
  <!-- The second way out: tapping the page behind the drawer. Shown only while
       the drawer is open, via the CSS sibling of .sidebar.show. -->
  <div class="sb-backdrop" data-toggle-sidebar aria-hidden="true"></div>`;
}

function roleLabel(role) {
  return {
    OWNER: 'مالک', DEVELOPER: 'دولوپر',
    SUPER_ADMIN: 'مدیر کل', SUPPORT: 'پشتیبانی', FINANCE: 'مالی',
  }[role] || '';
}

export function topbar(title, crumb) {
  const s = getState();
  const agent = isAgent();
  const active = s.access?.active;
  const suspended = Boolean(s.access?.suspended || s.sub?.suspended);

  return html`
  <div class="topbar">
    <button class="btn sm menubtn" data-toggle-sidebar>☰</button>
    <div>
      <h1>${title}</h1>
      ${crumb ? html`<div class="crumb">${crumb}</div>` : ''}
    </div>
    <div class="spacer"></div>
    ${
      // A sub-agency is not told subscription dates — its access follows the
      // parent's subscription, which it can neither see nor renew. It gets a
      // chip only when access is off, and without a date.
      agent
        ? s.user?.parentId
          ? active
            ? ''
            : html`<span class="tag r">دسترسی غیرفعال</span>`
          : html`<span class="tag ${active ? 'g' : 'r'}">
              ${
                // Three states, not two. A suspended account is also «not
                // active», and calling that «اشتراک منقضی» here would contradict
                // the banner three centimetres below it — the reader would be
                // told two different reasons for the same lock, on one screen.
                suspended
                  ? 'حساب تعلیق‌شده'
                  : active
                    ? `اشتراک فعال تا ${date(s.access?.expiresAt)}`
                    : 'اشتراک منقضی'
              }
            </span>`
        : ''
    }
    <div class="who">
      <div class="av">${(s.user?.fullName || '?').slice(0, 1)}</div>
      <div>
        <div class="nm">${s.user?.fullName || ''}</div>
        <div class="rl">${agent ? s.user?.agency?.name || '' : roleLabel(s.user?.role)}</div>
      </div>
    </div>
    <button class="btn sm" data-logout>خروج</button>
  </div>`;
}

/** Blueprint 7.3: a standing explanation, so nobody wonders why buttons are dead. */
/**
 * Why the account is suspended, and what the agency can do about it.
 *
 * Three things, deliberately: the fact, the reason with its number, and the one
 * action that is still open to them. A penalty with no stated cause and no way
 * to answer is not moderation, it is a locked door — and the ticket category
 * for exactly this appeal already exists.
 */
function suspendedBanner() {
  const s = getState();
  const strikes = s.data?.strikes;

  // A sub-agency is suspended by its own parent, not by the platform. It has no
  // strikes to read and no appeal to file here — telling it to open a ticket
  // with support would send it to people who cannot undo the thing that
  // happened to it.
  if (s.user?.parentId) {
    return html`
    <div class="banner danger">
      <span class="b-ico">⚑</span>
      <div class="b-txt">
        <b>حساب شما غیرفعال شده است</b>
        این حساب توسط نمایندگی مرکزی غیرفعال شده است. برای فعال شدن دوباره،
        با نمایندگی مرکزی خود هماهنگ کنید.
      </div>
    </div>`;
  }

  return html`
  <div class="banner danger">
    <span class="b-ico">⚑</span>
    <div class="b-txt">
      <b>حساب شما تعلیق شده است</b>
      ${
        strikes?.strikes
          ? html`به دلیل ${faDigits(strikes.strikes)} تخلف تأییدشده روی آگهی‌های شما.
              فهرست گزارش‌ها را در همین صفحه، بخش «وضعیت حساب»، می‌بینید.`
          : 'برای دیدن دلیل و اعتراض، از بخش پشتیبانی تیکت بزنید.'
      }
      تا زمان رفع تعلیق، ثبت آگهی و نمایش مشخصات برای شما بسته است — ولی
      آگهی‌های خودتان و سابقه‌تان سر جایشان هستند.
      <div style="margin-top:8px">
        <button class="btn sm" data-new-ticket="" data-category="APPEAL">اعتراض به تعلیق</button>
      </div>
    </div>
  </div>`;
}

export function expiredBanner() {
  const s = getState();
  // Only an agency can have an expired subscription. Asked as `!isAdmin()`,
  // this told a developer account its subscription had run out.
  if (!isAgent() || s.access?.active) return raw('');

  // Suspension first, because it is the reason that overrides the other one.
  //
  // A suspended account also has no entitlement, so without this it would be
  // told «اشتراک شما تمام شده است» and sent to the payment page — where paying
  // would change nothing. Being told the wrong reason is worse than being told
  // nothing: it costs them money and still leaves them locked out.
  if (s.access?.suspended || s.sub?.suspended) return suspendedBanner();

  // A sub-agency cannot renew anything — its access follows the parent's
  // subscription. Telling it to «تمدید اشتراک» would send it to a page it does
  // not have, about a payment that is not its to make.
  if (s.user?.parentId) {
    return html`
    <div class="banner warn">
      <span class="b-ico">⚠</span>
      <div class="b-txt">
        <b>دسترسی حساب شما فعال نیست</b>
        دسترسی زیرمجموعه از اشتراک نمایندگی مرکزی می‌آید. برای فعال شدن دوباره،
        با نمایندگی مرکزی خود هماهنگ کنید.
      </div>
    </div>`;
  }

  return html`
  <div class="banner warn">
    <span class="b-ico">⚠</span>
    <div class="b-txt">
      <b>اشتراک شما تمام شده است</b>
      حواله‌ها را می‌بینید، ولی <b>مشخصات تماس و کد نمایندگی مخفی است</b> و امکان ثبت حواله،
      ثبت درخواست خرید و تمدید آگهی ندارید.
    </div>
    <button class="btn primary" data-go="subscription">تمدید اشتراک</button>
  </div>`;
}

/** The reveal allowance, shown wherever an agent might be about to spend it. */
export function usageChip(usage) {
  if (!usage) return raw('');
  const left = Math.max(0, usage.dailyLimit - usage.dailyUsed);
  const tone = left === 0 ? 'r' : left <= 5 ? 'w' : '';

  return html`<span class="tag ${tone}">
    سقف امروز: ${faDigits(usage.dailyUsed)} از ${faDigits(usage.dailyLimit)}
  </span>`;
}
