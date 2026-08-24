import { html, raw } from './ui/html.js';
import { getState, subscribe } from './state/store.js';
import { route, resolve, startRouter, go } from './router.js';
import { boot, watchSession } from './session.js';
import { auth } from './api/index.js';
import { sidebar, topbar, expiredBanner } from './ui/shell.js';
import { renderToast, errorBox, loadingBox, closeModal, toast } from './ui/feedback.js';
import { renderModal, runModalAction } from './ui/modal.js';

import { loginPage, submitLogin, changePasswordPage, submitChangePassword } from './pages/auth.js';
import { loadDashboard, dashboardPage } from './pages/agent/dashboard.js';
import { loadSearch, searchPage, confirmReveal, onSearchBrandChange } from './pages/agent/search.js';
import {
  loadCatalogForm, loadMine, havaleFormPage, minePage, submitHavale, onBrandChange,
  renewModal, confirmFulfill, confirmDelete, havaleDetailModal,
} from './pages/agent/listings.js';
// The ثبت‌نامی market. Its own module, its own pages — see modules/registration
// on the server for the other half of the same separation.
import {
  loadRegSearch, loadRegForm, loadRegMine, regSearchPage, regFormPage, regMinePage,
  submitRegistration, onRegBrandChange, confirmRegReveal, regRenew, regFulfill, regDelete,
} from './pages/agent/registration.js';
import {
  loadSubscription, subscriptionPage, orderSeatsModal,
  loadSubAgents, subAgentsPage, newSubAgentModal, subAgentPasswordModal, subAgentBrandsModal,
  loadTickets, ticketsPage, loadTicket, ticketPage, newTicketModal, submitTicketReply,
  reportModal,
} from './pages/agent/account.js';
import { soonPage } from './pages/agent/soon.js';
import { profilePage, submitProfilePassword } from './pages/agent/profile.js';
import {
  registerAdminRoutes, renderAdminPage, handleAdminClick, handleAdminSubmit, onStaffFormChange,
  setCatalogQuery,
} from './pages/admin/index.js';
import {
  handleBrandPickClick, handleBrandPickChange, handleBrandPickSearch,
} from './ui/brandPicker.js';
import {
  handlePickSelectClick, handlePickSelectSearch, handlePickSelectKey, repositionPickSelects,
} from './ui/pickSelect.js';
import { handleJalaliDateChange } from './ui/dateInput.js';
import { SOON_PAGES } from './ui/shell.js';
import { toggleNavSection, toggleSidebar, closeSidebar } from './state/store.js';
import { subAgents, tickets, subscription } from './api/index.js';

/** Page titles, so the top bar and the document title agree. */
const TITLES = {
  dash: ['داشبورد', 'خلاصه‌ی وضعیت شما'],
  search: ['استعلام حواله‌ها', 'جستجو در حواله‌های موجود'],
  'new-offer': ['ثبت حواله فروش', 'حواله‌ای که دارید و می‌فروشید'],
  'new-request': ['ثبت درخواست خرید', 'حواله‌ای که می‌خواهید بخرید'],
  mine: ['حواله‌های من', 'همه‌ی آگهی‌های شما'],
  'reg-search': ['استعلام ثبت‌نامی', 'ظرفیت‌ها و درخواست‌های ثبت‌نام'],
  'reg-offer': ['اعلام ظرفیت ثبت‌نام', 'ظرفیتی که دارید و واگذار می‌کنید'],
  'reg-request': ['ثبت درخواست ثبت‌نام', 'ظرفیتی که دنبالش هستید'],
  'reg-mine': ['ثبت‌نامی‌های من', 'همه‌ی آگهی‌های ثبت‌نامی شما'],
  subscription: ['اشتراک من', 'وضعیت، صورتحساب و ظرفیت'],
  'sub-agents': ['زیرنمایندگی‌ها', 'حالت ماژول'],
  tickets: ['پشتیبانی', 'گفتگو با تیم پشتیبانی'],
  ticket: ['گفتگو', ''],
  profile: ['تنظیمات حساب', 'مشخصات نمایندگی و رمز عبور'],
  'no-access': ['دسترسی تعیین نشده', ''],
};

/**
 * Titles for the sections that are not built yet, derived from the menu itself.
 *
 * Written out by hand, these would be a second list to keep in step with the
 * first — and the one that drifts is always the one nobody sees fail.
 */
for (const [page, { section, child }] of SOON_PAGES) {
  TITLES[page] = [child.label, section.label];
}

function registerRoutes() {
  route('dash', loadDashboard);
  route('search', loadSearch);
  route('new-offer', loadCatalogForm);
  route('new-request', loadCatalogForm);
  route('mine', loadMine);

  route('reg-search', loadRegSearch);
  route('reg-offer', loadRegForm);
  route('reg-request', loadRegForm);
  route('reg-mine', loadRegMine);
  route('subscription', loadSubscription);
  route('sub-agents', loadSubAgents);
  route('tickets', loadTickets);
  route('ticket', loadTicket);
  route('profile', async () => ({}));
  // Registered so the router recognises them: an unknown page silently
  // redirects home, which would make every one of these menu items look like
  // a dead click rather than a section that is on its way.
  for (const page of SOON_PAGES.keys()) route(page, async () => ({}));
  registerAdminRoutes(route);
}

/**
 * An account that can sign in and reach nothing.
 *
 * Every box unticked is a state the owner can now produce in two clicks, and
 * the DEVELOPER role starts there by design. Without this the panel opened onto
 * an empty frame or a refusal, which reads as a broken system rather than a
 * deliberate one — and the person it happens to has no way to tell the
 * difference or to know who to ask.
 */
function noAccessPage() {
  return html`
  <div class="soon-card">
    <h2>هنوز دسترسی‌ای برای این حساب تعیین نشده است</h2>
    <p>
      حساب شما ساخته شده و ورودتان درست بوده، ولی هیچ بخشی برایتان فعال نیست.
      این یعنی خطا رخ نداده — فقط هنوز کسی تیک دسترسی‌ها را نزده است.
    </p>
    <p>از مالک سامانه بخواهید دسترسی‌های لازم را برایتان فعال کند.</p>
  </div>`;
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
    case 'reg-search': return regSearchPage();
    case 'reg-offer': return regFormPage('OFFER');
    case 'reg-request': return regFormPage('REQUEST');
    case 'reg-mine': return regMinePage();
    case 'subscription': return subscriptionPage();
    case 'sub-agents': return subAgentsPage();
    case 'tickets': return ticketsPage();
    case 'ticket': return ticketPage();
    case 'profile': return profilePage();
    case 'no-access': return noAccessPage();
    default:
      if (SOON_PAGES.has(page)) return soonPage();
      return renderAdminPage(page);
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
    // While the next page loads, the current one stays — dimmed, with a thin
    // bar at the top. The alternative, blanking the body, made a fetch of a
    // tenth of a second read as a stall.
    const busy = Boolean(state.navigating);
    root.innerHTML = String(html`
      <div class="shell">
        ${sidebar()}
        <main class="main">
          ${busy ? html`<div class="navbar-load"></div>` : ''}
          ${topbar(title || adminTitle(state.page), crumb)}
          <div class="content ${busy ? 'is-busy' : ''}">
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
    'adm-havales': 'مدیریت حواله‌ها',
    'adm-registrations': 'مدیریت ثبت‌نامی‌ها',
    'adm-listing': 'پرونده‌ی آگهی',
    'adm-reports': 'گزارش‌های تخلف',
    'adm-tickets': 'پشتیبانی',
    'adm-catalog': 'کاتالوگ خودرو',
    'adm-monitor': 'مانیتورینگ',
    'adm-seats': 'درخواست‌های ظرفیت',
    'adm-settings': 'تنظیمات',
    'adm-staff': 'کاربران سیستم',
    'adm-errors': 'لاگ فنی',
    'adm-security': 'لاگ امنیتی',
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
  'go', 'logout', 'toggleSidebar', 'closeModal', 'confirm', 'nextCursor', 'navSection',
  'reveal', 'report', 'renew', 'fulfill', 'deleteHavale', 'openHavale',
  'regReveal', 'regRenew', 'regFulfill', 'regDelete',
  'orderSeats', 'newSubagent', 'subagentStatus', 'subagentPassword', 'subagentBrands',
  'newTicket', 'closeTicket', 'reopenTicket', 'ticketPriority', 'ackSeat',
  'activity', 'reviewReport', 'approveSuspension', 'seatReview',
  'havaleSuspend', 'havaleUnsuspend', 'havaleRemove', 'havaleRestore',
  'agentStatus', 'agentPassword', 'agentLogout', 'agentLimits', 'agentBrands', 'editAgent',
  'grant', 'editSetting',
  'newStaff', 'editStaff', 'staffPassword', 'staffStatus', 'permAll', 'permNone',
  'error', 'resolveError', 'testAlert',
  'secEvent', 'secResolve', 'block', 'unblock',
  'newCompany', 'newBrand', 'newModel', 'newColor',
  'editCompany', 'editBrand', 'editModel', 'editColor',
  'toggleCompany', 'toggleBrand', 'toggleModel', 'toggleColor',
  'brandAll', 'brandNone', 'brandExpand',
]);

function findTarget(node) {
  for (let el = node; el && el !== document; el = el.parentElement) {
    if (el.hasAttribute?.('data-overlay')) return el;
    if (el.dataset && Object.keys(el.dataset).some((key) => CLICK_KEYS.has(key))) return el;
  }
  return null;
}

function onClick(event) {
  // The searchable selects handle themselves and are not in the data-key
  // registry: their own click closes any that are open, and a click anywhere
  // else in the app closes them too — which is what a dropdown must do.
  if (handlePickSelectClick(event.target)) return;

  const el = findTarget(event.target);
  if (!el) return;

  const d = el.dataset;

  if (el.hasAttribute('data-overlay') && event.target !== el) return;

  if (d.go !== undefined) {
    // On a phone the menu is an overlay covering the page. Following a link
    // without closing it left the reader looking at the menu they had just
    // used, with the page they asked for hidden behind it.
    closeSidebar();
    const params = Object.fromEntries(new URLSearchParams(d.goParams || ''));
    return go(d.go, params);
  }
  if (d.navSection) return toggleNavSection(d.navSection);
  if (d.toggleSidebar !== undefined) return toggleSidebar();
  if (d.closeModal !== undefined || el.hasAttribute('data-overlay')) return closeModal();
  if (d.confirm !== undefined) return runModalAction(null);
  if (d.logout !== undefined) return doLogout();

  if (d.reveal) return confirmReveal(d.reveal);
  if (d.regReveal) return confirmRegReveal(d.regReveal);
  if (d.regRenew) return regRenew(d.regRenew, d.regKind);
  if (d.regFulfill) return regFulfill(d.regFulfill);
  if (d.regDelete) return regDelete(d.regDelete);
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
  if (d.subagentBrands) return subAgentBrandsModal(d.subagentBrands);
  if (d.newTicket !== undefined) return newTicketModal(d.newTicket, d.category);
  if (d.closeTicket) return closeTicket(d.closeTicket);
  if (d.reopenTicket) return reopenTicket(d.reopenTicket);
  if (d.ticketPriority) return setTicketPriority(d.ticketPriority, d.priority);
  if (d.ackSeat) return ackSeatOrder(d.ackSeat);

  // The brand picker appears on admin pages and inside the agent's sub-agency
  // modal alike, so its buttons are dispatched here rather than per page.
  if (handleBrandPickClick(d)) return undefined;

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

// Staff-side ticket controls. The server enforces who may do what — an agent
// calling reopen gets a refusal, not a surprise.
async function ackSeatOrder(id) {
  try {
    await subscription.ackSeatOrder(id);
    await resolve();
  } catch (err) {
    toast(err.message, 'danger');
  }
}

async function reopenTicket(id) {
  try {
    await tickets.setStatus(id, 'OPEN');
    await resolve();
  } catch (err) {
    toast(err.message, 'danger');
  }
}

async function setTicketPriority(id, priority) {
  try {
    await tickets.setPriority(id, priority);
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
    case 'registration': return submitRegistration(form);
    case 'reg-filters': return applyRegFilters(form);
    case 'profile-password': return submitProfilePassword(form);
    case 'ticket-reply': return submitTicketReply(form);
    case 'modal': return runModalAction(form);
    case 'search-filters': return applyFilters(form);
    default: return handleAdminSubmit(form);
  }
}

function applyRegFilters(form) {
  const params = {};
  new FormData(form).forEach((value, key) => {
    if (value !== '') params[key] = value;
  });
  go('reg-search', params);
}

function applyFilters(form) {
  const params = {};
  new FormData(form).forEach((value, key) => {
    if (value !== '') params[key] = value;
  });
  go('search', params);
}

/**
 * Typing in the catalogue's brand filter.
 *
 * `input` rather than `change`, because a filter that only reacts when you
 * click away is a filter you stop using. It filters the brands already in
 * memory — no request per keystroke, and 186 rows is nothing to a browser.
 *
 * The caret has to be put back by hand: every render replaces the page, so the
 * input the reader is typing into is a different element by the time the next
 * character arrives.
 */
function onCatalogSearch(event) {
  const input = event.target;

  // The brand picker filters by hiding rows in place — no re-render, so the
  // input keeps its own caret and the ticked boxes keep themselves.
  if (handleBrandPickSearch(input)) return;

  // The search inside a pick-select — options shown and hidden in place.
  if (handlePickSelectSearch(input)) return;

  if (!input.matches?.('[data-catalog-search]')) return;

  const at = input.selectionStart;
  setCatalogQuery(input.value);

  const again = document.querySelector('[data-catalog-search]');
  if (again) {
    again.focus();
    again.setSelectionRange(at, at);
  }
}

function onChange(event) {
  // Ticking a brand, or a whole company at once. Handled entirely in the DOM —
  // the picker sits inside a form, and anything that re-rendered the page here
  // would wipe every field the reader had typed.
  if (handleBrandPickChange(event.target)) return;

  // Choosing a day, month or year in a Jalali date field. It writes the
  // Gregorian value into its own hidden input and trims the day list to the
  // month — in the DOM, for the same reason as the picker above.
  if (handleJalaliDateChange(event.target)) return;

  // Each market fills its own model list. Dispatched by which form asked
  // rather than shared: the two look alike today, and the whole point of the
  // separation is that one of them can change tomorrow without the other
  // noticing.
  if (event.target.name === 'brand') {
    const form = event.target.form;
    if (form?.dataset.form === 'registration') {
      onRegBrandChange(form);
      return;
    }
    onBrandChange(form);
  }
  // The ticket composer's paperclip: echo the chosen filenames next to it, so
  // «پیوست شد» is visible before anything is sent.
  if (event.target.matches?.('[data-attach-input]')) {
    const names = event.target.closest('form')?.querySelector('[data-attach-names]');
    if (names) {
      names.textContent = [...event.target.files].map((f) => f.name).join('، ');
    }
  }
  // The search filters' brand box: swap the model options in place.
  if (event.target.name === 'brandId' && event.target.form?.dataset.form === 'search-filters') {
    onSearchBrandChange(event.target.form);
  }
  // Choosing a role re-ticks its default permissions. Delegated like every
  // other handler, because the modal is rebuilt on each render and anything
  // bound to an element would be bound to one that no longer exists.
  if (event.target.name === 'role') {
    onStaffFormChange(event.target);
  }
}

function onKeydown(event) {
  // Enter picks the only remaining option, Escape closes the panel — handled
  // before the app-wide Escape, so closing a dropdown does not also close the
  // modal it sits in.
  if (handlePickSelectKey(event)) return;

  if (event.key !== 'Escape') return;
  // The modal sits on top of the drawer, so it goes first — one Escape should
  // dismiss one thing, the one the reader is looking at.
  if (getState().modal) return closeModal();
  closeSidebar();
}

async function start() {
  watchSession();
  registerRoutes();
  subscribe(render);

  document.addEventListener('click', onClick);
  document.addEventListener('submit', onSubmit);
  document.addEventListener('change', onChange);
  document.addEventListener('input', onCatalogSearch);
  document.addEventListener('keydown', onKeydown);
  // An open dropdown is positioned in screen coordinates, so it has to be told
  // when the screen moves under it. `capture` because the page scrolls inside
  // .main, not on the window, and a scroll event does not bubble.
  document.addEventListener('scroll', repositionPickSelects, true);
  window.addEventListener('resize', repositionPickSelects);

  startRouter();
  await boot();
  await resolve();
  render();
}

start();
