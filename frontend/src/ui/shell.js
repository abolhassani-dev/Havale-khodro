import { html, raw } from './html.js';
import { icon } from './icons.js';
import { getState, isAdmin, can } from '../state/store.js';
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
    soon: true,
    children: [
      { page: 'reg-search', icon: 'search', label: 'استعلام ثبت‌نامی' },
      { page: 'reg-request', icon: 'plus', label: 'ثبت درخواست ثبت‌نام' },
      { page: 'reg-offer', icon: 'inbox', label: 'اعلام ظرفیت ثبت‌نام' },
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
      { page: 'subscription', icon: 'clock', label: 'اشتراک من' },
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

const ADMIN_NAV = [
  { group: 'مدیریت' },
  { page: 'adm-dash', icon: 'dashboard', label: 'داشبورد', permission: 'monitoring' },
  { page: 'adm-agents', icon: 'shield', label: 'نمایندگی‌ها', permission: 'agents' },
  { page: 'adm-new-agent', icon: 'plus', label: 'ساخت نمایندگی', permission: 'agents' },
  { group: 'محتوا' },
  { page: 'adm-reports', icon: 'flag', label: 'گزارش تخلف', permission: 'reports' },
  { page: 'adm-tickets', icon: 'ticket', label: 'تیکت‌ها', permission: 'tickets' },
  { page: 'adm-catalog', icon: 'car', label: 'کاتالوگ خودرو', permission: 'catalog' },
  { group: 'نظارت و مالی' },
  { page: 'adm-monitor', icon: 'eye', label: 'مانیتورینگ', permission: 'monitoring' },
  { page: 'adm-seats', icon: 'layers', label: 'درخواست ظرفیت', permission: 'seats' },
  { page: 'adm-settings', icon: 'settings', label: 'تنظیمات', permission: 'settings' },
];

function link(item, current) {
  return html`<a class="${item.page === current ? 'on' : ''}" data-go="${item.page}">
    <span class="ico">${icon(item.icon)}</span>${item.label}
  </a>`;
}

/** Hides entries the account cannot use, so no menu item answers "not for you". */
function visible(children, user) {
  return children.filter((child) => (child.needsReseller ? Boolean(user?.isReseller) : true));
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

  const body = admin
    ? ADMIN_NAV.filter((item) => (item.permission ? can(item.permission) : true)).map((item) =>
        adminItem(item, s.page)
      )
    : AGENT_NAV.map((item) =>
        item.children
          ? navSection(item, s.page, s.openNav || [], s.user)
          : link(item, s.page)
      );

  const footer = admin
    ? html`<b>${s.user?.fullName || ''}</b>${roleLabel(s.user?.role)}`
    : html`<b>${s.user?.agency?.code || ''}</b>${s.user?.agency?.name || ''} — ${s.user?.agency?.city || ''}`;

  return html`
  <aside class="sidebar ${s.sidebarOpen ? 'show' : ''}" id="sb">
    <div class="brand">
      <div class="mark"><img src="/assets/logo.svg" alt=""> ${BRAND.nameFa}</div>
      <div class="sub">${admin ? 'پنل مدیریت' : 'پنل نمایندگی‌ها'}</div>
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
  return { SUPER_ADMIN: 'مدیر کل', SUPPORT: 'پشتیبانی', FINANCE: 'مالی' }[role] || '';
}

export function topbar(title, crumb) {
  const s = getState();
  const admin = isAdmin();
  const active = s.access?.active;

  return html`
  <div class="topbar">
    <button class="btn sm menubtn" data-toggle-sidebar>☰</button>
    <div>
      <h1>${title}</h1>
      ${crumb ? html`<div class="crumb">${crumb}</div>` : ''}
    </div>
    <div class="spacer"></div>
    ${
      admin
        ? ''
        : html`<span class="tag ${active ? 'g' : 'r'}">
            ${active ? `اشتراک فعال تا ${date(s.access?.expiresAt)}` : 'اشتراک منقضی'}
          </span>`
    }
    <div class="who">
      <div class="av">${(s.user?.fullName || '?').slice(0, 1)}</div>
      <div>
        <div class="nm">${s.user?.fullName || ''}</div>
        <div class="rl">${admin ? roleLabel(s.user?.role) : s.user?.agency?.name || ''}</div>
      </div>
    </div>
    <button class="btn sm" data-logout>خروج</button>
  </div>`;
}

/** Blueprint 7.3: a standing explanation, so nobody wonders why buttons are dead. */
export function expiredBanner() {
  const s = getState();
  if (isAdmin() || s.access?.active) return raw('');

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
