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
  // Whether the phone drawer is showing — and here for exactly the same reason,
  // which the first version of this got wrong. It toggled a class on the live
  // element instead, so the drawer survived until the next render and then
  // disappeared: tapping ☰ opened it, tapping a section to expand it re-rendered
  // the shell, and the whole menu was gone. Which looks, from the outside, like
  // a menu that cannot be closed and cannot be used.
  sidebarOpen: false,
};

/** Opens a sidebar section, or closes it if it was already open. */
export function toggleNavSection(id) {
  const open = state.openNav.includes(id);
  setState({ openNav: open ? state.openNav.filter((x) => x !== id) : [...state.openNav, id] });
}

export function toggleSidebar() {
  setState({ sidebarOpen: !state.sidebarOpen });
}

export function closeSidebar() {
  if (state.sidebarOpen) setState({ sidebarOpen: false });
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
 * An agency, as opposed to anybody who merely is not an administrator.
 *
 * The two used to be the same question and the code asked it the second way,
 * with `!isAdmin()`. Then a role appeared that is neither — DEVELOPER — and
 * every one of those places quietly claimed it was an agency: it was shown the
 * agency menu, asked for a subscription it cannot have, and told its
 * subscription had expired.
 */
export function isAgent() {
  return state.user?.role === 'AGENT';
}

/**
 * Permissions, as resolved by the server for this account.
 *
 * The interface used to keep its own copy of the policy table and decide from
 * that. Two copies of one rule is two rules, and these had already drifted —
 * the frontend's SUPER_ADMIN was missing `export`. Worse, a per-account tick
 * would have been invisible to it entirely, because a copied table can only
 * ever answer about roles.
 *
 * So the server sends the answer rather than the rules, and this reads it.
 *
 * As always, this decides what to *show* and never what to allow: the server
 * checks every request regardless. Hiding a button the server would refuse is
 * courtesy; relying on it would be the classic mistake, since this code runs on
 * the viewer's machine.
 */
export function can(permission) {
  return Boolean(state.user?.permissions?.[permission]);
}
