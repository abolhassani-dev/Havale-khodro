import { html, raw } from './ui/html.js';
import { getState, subscribe, isAdmin } from './state/store.js';
import { route, resolve, startRouter, go } from './router.js';
import { boot, watchSession } from './session.js';
import { auth } from './api/index.js';
import { sidebar, topbar, expiredBanner } from './ui/shell.js';
import { renderToast, errorBox, loadingBox, closeModal, toast } from './ui/feedback.js';
import { renderModal, runModalAction } from './ui/modal.js';

import { loginPage, submitLogin, changePasswordPage, submitChangePassword } from './pages/auth.js';
import { loadDashboard, dashboardPage } from './pages/agent/dashboard.js';
import { loadSearch, searchPage, confirmReveal } from './pages/agent/search.js';
import {
  loadCatalogForm, loadMine, havaleFormPage, minePage, submitHavale, onBrandChange,
  renewModal, confirmFulfill, confirmDelete, havaleDetailModal,
} from './pages/agent/listings.js';
import {
  loadSubscription, subscriptionPage, orderSeatsModal,
  loadSubAgents, subAgentsPage, newSubAgentModal, subAgentPasswordModal,
  loadTickets, ticketsPage, loadTicket, ticketPage, newTicketModal, submitTicketReply,
  reportModal,
} from './pages/agent/account.js';
import { registerAdminRoutes, renderAdminPage, handleAdminClick, handleAdminSubmit } from './pages/admin/index.js';
import { subAgents, tickets } from './api/index.js';

/** Page titles, so the top bar and the document title agree. */
const TITLES = {
  dash: ['داشبورد', 'خلاصه‌ی وضعیت شما'],
  search: ['استعلام حواله‌ها', 'جستجو در حواله‌های موجود'],
  'new-offer': ['ثبت حواله فروش', 'حواله‌ای که دارید و می‌فروشید'],
  'new-request': ['ثبت درخواست خرید', 'حواله‌ای که می‌خواهید بخرید'],
  mine: ['حواله‌های من', 'همه‌ی آگهی‌های شما'],
  subscription: ['اشتراک من', 'وضعیت، صورتحساب و ظرفیت'],
  'sub-agents': ['زیرنمایندگی‌ها', 'حالت ماژول'],
  tickets: ['پشتیبانی', 'تیکت‌های شما'],
  ticket: ['تیکت', ''],
};

function registerRoutes() {
  route('dash', loadDashboard);
  route('search', loadSearch);
  route('new-offer', loadCatalogForm);
  route('new-request', loadCatalogForm);
  route('mine', loadMine);
  route('subscription', loadSubscription);
  route('sub-agents', loadSubAgents);
  route('tickets', loadTickets);
  route('ticket', loadTicket);
  registerAdminRoutes(route);
}

function pageBody() {
  const { page, loading, error } = getState();

  if (loading) return loadingBox();
  if (error) return errorBox(error);

  switch (page) {
    case 'dash': return dashboardPage();
    case 'search': return searchPage();
    case 'new-offer': return havaleFormPage('OFFER');
    case 'new-request': return havaleFormPage('REQUEST');
    case 'mine': return minePage();
    case 'subscription': return subscriptionPage();
    case 'sub-agents': return subAgentsPage();
    case 'tickets': return ticketsPage();
    case 'ticket': return ticketPage();
    default: return renderAdminPage(page);
  }
}

function render() {
  const state = getState();
  const root = document.getElementById('root');

  if (!state.user) {
    root.innerHTML = String(loginPage());
  } else if (state.user.mustChangePassword) {
    root.innerHTML = String(changePasswordPage());
  } else {
    const [title, crumb] = TITLES[state.page] || ['', ''];
    root.innerHTML = String(html`
      <div class="shell">
        ${sidebar()}
        <main class="main">
          ${topbar(title || adminTitle(state.page), crumb)}
          <div class="content">
            ${expiredBanner()}
            ${pageBody()}
          </div>
        </main>
      </div>`);
  }

  document.getElementById('layer').innerHTML = String(html`${renderModal()}${renderToast()}`);
  labelTables();
}

/**
 * Copies each table's column headings onto its cells as `data-label`.
 *
 * This is what lets a phone drop the table layout entirely: below 700px the
 * stylesheet stacks every row into a small card and prints the heading beside
 * each value from this attribute. Done here, once, after every render — so
 * every table in the product is phone-ready automatically, instead of each
 * screen having to remember a second mobile markup.
 */
function labelTables() {
  document.querySelectorAll('.card table').forEach((table) => {
    const heads = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    if (!heads.length) return;
    table.querySelectorAll('tbody tr').forEach((tr) => {
      [...tr.children].forEach((td, i) => {
        if (heads[i]) td.setAttribute('data-label', heads[i]);
      });
    });
  });
}

function adminTitle(page) {
  return {
    'adm-dash': 'داشبورد مدیریت',
    'adm-agents': 'نمایندگی‌ها',
    'adm-agent': 'پرونده‌ی نمایندگی',
    'adm-new-agent': 'ساخت نمایندگی',
    'adm-reports': 'گزارش‌های تخلف',
    'adm-tickets': 'تیکت‌ها',
    'adm-catalog': 'کاتالوگ خودرو',
    'adm-monitor': 'مانیتورینگ',
    'adm-seats': 'درخواست‌های ظرفیت',
    'adm-settings': 'تنظیمات',
  }[page] || '';
}

/**
 * One click listener for the whole app.
 *
 * Behaviour is attached with `data-` attributes rather than inline `onclick`,
 * and the reason is not tidiness: an inline handler built by string
 * interpolation is a script-injection point, and the interpolated values here
 * are things users typed. Delegation also survives the innerHTML replacement
 * that every render performs, so nothing has to be re-bound.
 */
/**
 * The attributes a click can carry.
 *
 * Listed once, and matched by walking up from the target rather than by a
 * hand-written CSS selector. The selector version was one entry short of
 * complete and every admin action was silently dead — a whole panel of buttons
 * that did nothing, because a click handler that matches nothing fails in
 * perfect silence. Adding a screen must not require remembering to edit a
 * string somewhere else.
 */
const CLICK_KEYS = new Set([
  'go', 'logout', 'toggleSidebar', 'closeModal', 'confirm', 'nextCursor',
  'reveal', 'report', 'renew', 'fulfill', 'deleteHavale', 'openHavale',
  'orderSeats', 'newSubagent', 'subagentStatus', 'subagentPassword',
  'newTicket', 'closeTicket',
  'activity', 'reviewReport', 'approveSuspension', 'seatReview',
  'agentStatus', 'agentPassword', 'agentLogout', 'agentLimits', 'editAgent',
  'grant', 'editSetting',
  'newCompany', 'newBrand', 'newModel', 'newColor',
  'editCompany', 'editBrand', 'editModel', 'editColor',
  'toggleCompany', 'toggleBrand', 'toggleModel', 'toggleColor',
]);

function findTarget(node) {
  for (let el = node; el && el !== document; el = el.parentElement) {
    if (el.hasAttribute?.('data-overlay')) return el;
    if (el.dataset && Object.keys(el.dataset).some((key) => CLICK_KEYS.has(key))) return el;
  }
  return null;
}

function onClick(event) {
  const el = findTarget(event.target);
  if (!el) return;

  const d = el.dataset;

  if (el.hasAttribute('data-overlay') && event.target !== el) return;

  if (d.go !== undefined) {
    const params = Object.fromEntries(new URLSearchParams(d.goParams || ''));
    return go(d.go, params);
  }
  if (d.toggleSidebar !== undefined) return document.getElementById('sb')?.classList.toggle('show');
  if (d.closeModal !== undefined || el.hasAttribute('data-overlay')) return closeModal();
  if (d.confirm !== undefined) return runModalAction(null);
  if (d.logout !== undefined) return doLogout();

  if (d.reveal) return confirmReveal(d.reveal);
  if (d.report) return reportModal(d.report);
  if (d.renew) return renewModal(d.renew);
  if (d.fulfill) return confirmFulfill(d.fulfill);
  if (d.deleteHavale) return confirmDelete(d.deleteHavale);
  if (d.openHavale) return havaleDetailModal(d.openHavale);
  if (d.nextCursor) return go('search', { ...getState().params, cursor: d.nextCursor });

  if (d.orderSeats !== undefined) return orderSeatsModal();
  if (d.newSubagent !== undefined) return newSubAgentModal();
  if (d.subagentStatus) return setSubAgentStatus(d.subagentStatus, d.status);
  if (d.subagentPassword) return subAgentPasswordModal(d.subagentPassword);
  if (d.newTicket !== undefined) return newTicketModal(d.newTicket);
  if (d.closeTicket) return closeTicket(d.closeTicket);

  return handleAdminClick(d, el);
}

async function setSubAgentStatus(id, status) {
  try {
    await subAgents.setStatus(id, status);
    toast(status === 'SUSPENDED' ? 'زیرنماینده تعلیق شد' : 'زیرنماینده فعال شد');
    await resolve();
  } catch (err) {
    toast(err.message, 'danger');
  }
}

async function closeTicket(id) {
  try {
    await tickets.setStatus(id, 'CLOSED');
    await resolve();
  } catch (err) {
    toast(err.message, 'danger');
  }
}

async function doLogout() {
  await auth.logout().catch(() => {});
  window.location.hash = '';
  window.location.reload();
}

function onSubmit(event) {
  const form = event.target;
  if (!form.matches('form[data-form]')) return;
  event.preventDefault();

  switch (form.dataset.form) {
    case 'login': return submitLogin(form);
    case 'change-password': return submitChangePassword(form);
    case 'havale': return submitHavale(form);
    case 'ticket-reply': return submitTicketReply(form);
    case 'modal': return runModalAction(form);
    case 'search-filters': return applyFilters(form);
    default: return handleAdminSubmit(form);
  }
}

function applyFilters(form) {
  const params = {};
  new FormData(form).forEach((value, key) => {
    if (value !== '') params[key] = value;
  });
  go('search', params);
}

function onChange(event) {
  if (event.target.name === 'brand') {
    onBrandChange(event.target.form);
  }
}

function onKeydown(event) {
  if (event.key === 'Escape' && getState().modal) closeModal();
}

async function start() {
  watchSession();
  registerRoutes();
  subscribe(render);

  document.addEventListener('click', onClick);
  document.addEventListener('submit', onSubmit);
  document.addEventListener('change', onChange);
  document.addEventListener('keydown', onKeydown);

  startRouter();
  await boot();
  await resolve();
  render();
}

start();
