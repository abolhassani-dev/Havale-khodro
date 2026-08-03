import { html, raw } from './html.js';
import { icon } from './icons.js';
import { getState, isAdmin, can } from '../state/store.js';
import { date, faDigits } from './format.js';
import { BRAND } from '../constants.js';

/**
 * The frame every page sits in: sidebar, top bar, and the expired-subscription
 * banner.
 */

const AGENT_NAV = [
  { group: 'حواله' },
  { page: 'dash', icon: 'dashboard', label: 'داشبورد' },
  { page: 'search', icon: 'search', label: 'استعلام حواله‌ها' },
  { page: 'new-offer', icon: 'plus', label: 'ثبت حواله جدید' },
  { page: 'new-request', icon: 'inbox', label: 'ثبت درخواست خرید' },
  { page: 'mine', icon: 'list', label: 'حواله‌های من' },
  { group: 'حساب' },
  { page: 'subscription', icon: 'clock', label: 'اشتراک من' },
  { page: 'sub-agents', icon: 'users', label: 'زیرنمایندگی‌ها', needsReseller: true },
  { page: 'tickets', icon: 'mail', label: 'پشتیبانی' },
];

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

function navItem(item, current) {
  if (item.group) return html`<div class="group">${item.group}</div>`;

  return html`<a class="${item.page === current ? 'on' : ''}" data-go="${item.page}">
    <span class="ico">${icon(item.icon)}</span>${item.label}
  </a>`;
}

export function sidebar() {
  const s = getState();
  const admin = isAdmin();

  const items = (admin ? ADMIN_NAV : AGENT_NAV).filter((item) => {
    if (item.permission) return can(item.permission);
    // Module mode is off for most agencies, and a menu entry that always
    // answers "not enabled for you" is just noise in the way.
    if (item.needsReseller) return Boolean(s.user?.isReseller);
    return true;
  });

  const footer = admin
    ? html`<b>${s.user?.fullName || ''}</b>${roleLabel(s.user?.role)}`
    : html`<b>${s.user?.agency?.code || ''}</b>${s.user?.agency?.name || ''} — ${s.user?.agency?.city || ''}`;

  return html`
  <aside class="sidebar" id="sb">
    <div class="brand">
      <div class="mark"><img src="/assets/logo.svg" alt=""> ${BRAND.nameFa}</div>
      <div class="sub">${admin ? 'پنل مدیریت' : 'پنل نمایندگی‌ها'}</div>
    </div>
    <nav class="nav">${items.map((item) => navItem(item, s.page))}</nav>
    <div class="sidefoot">${footer}</div>
  </aside>`;
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
