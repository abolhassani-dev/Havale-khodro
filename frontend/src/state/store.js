/**
 * Application state.
 *
 * Small and deliberate: who is signed in, which page is showing, and whatever
 * that page loaded. Anything the server owns — listings, subscriptions, reveal
 * counts — is fetched when a page opens rather than cached here, because a stale
 * copy of a reveal count or a subscription date is worse than a short wait.
 */

const state = {
  user: null,
  access: null,
  page: null,
  params: {},
  data: {},
  loading: false,
  modal: null,
  // Load failures only. There is nothing to show, so the whole page body is
  // replaced by the message.
  //
  // A *submission* being refused is deliberately not stored here. It used to
  // be, and because render() rebuilds the page by replacing innerHTML, telling
  // the user what was wrong re-created every input as an empty one — they were
  // told and lost everything they had typed in the same instant. Form errors
  // are written straight into the form now (ui/feedback.js).
  error: null,
  toast: null,
  // Which sidebar sections the reader has opened by hand. Kept in state and not
  // in the DOM because every render replaces the sidebar wholesale — read off
  // the markup, the menu would snap shut on every click inside it.
  openNav: [],
};

/** Opens a sidebar section, or closes it if it was already open. */
export function toggleNavSection(id) {
  const open = state.openNav.includes(id);
  setState({ openNav: open ? state.openNav.filter((x) => x !== id) : [...state.openNav, id] });
}

const subscribers = new Set();

export function getState() {
  return state;
}

export function setState(patch) {
  Object.assign(state, patch);
  subscribers.forEach((fn) => fn(state));
}

export function subscribe(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

export function isAdmin() {
  return Boolean(state.user && state.user.isAdmin);
}

/**
 * Permissions, mirroring the server's table.
 *
 * This decides what to *show*, never what to allow — the server checks every
 * request regardless. Hiding a button the server would refuse is courtesy;
 * relying on the hidden button for security would be the classic mistake, since
 * this code runs on the viewer's machine.
 */
const PERMISSIONS = {
  SUPER_ADMIN: {
    tickets: true, reports: true, contactEdit: true, thirdStrike: true,
    subscriptions: true, seats: true, agents: true, monitoring: true,
    bulkContacts: true, settings: true, catalog: true,
  },
  SUPPORT: { tickets: true, reports: true, contactEdit: true },
  FINANCE: { subscriptions: true, seats: true },
  AGENT: {},
};

export function can(permission) {
  const role = state.user?.role;
  return Boolean(role && PERMISSIONS[role] && PERMISSIONS[role][permission]);
}
