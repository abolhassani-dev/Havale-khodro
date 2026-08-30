import { getState, setState, isAdmin, isAgent } from './state/store.js';
import { adminHome } from './ui/shell.js';
import { admin, notices } from './api/index.js';

/**
 * Routing on the hash.
 *
 * The hash rather than the History API for one practical reason: nginx serves
 * this as static files, and a real path like /havales/123 would 404 on refresh
 * unless every route is rewritten server-side. A hash never reaches the server,
 * so refresh and deep links work with no server configuration to get wrong.
 */

const routes = new Map();

/** Guards against a slow loader answering after a newer one — see resolve(). */
let navToken = 0;

export function route(name, loader) {
  routes.set(name, loader);
}

export function go(page, params = {}) {
  const query = new URLSearchParams(params).toString();
  window.location.hash = query ? `#${page}?${query}` : `#${page}`;
}

function parseHash() {
  const raw = window.location.hash.replace(/^#/, '');
  if (!raw) return { page: null, params: {} };

  const [page, query] = raw.split('?');
  return { page, params: Object.fromEntries(new URLSearchParams(query || '')) };
}

/**
 * Where somebody lands when they arrive with no route.
 *
 * For an administrator that is the first page their own menu offers, not the
 * dashboard: the dashboard needs `monitoring`, so sending everybody there
 * opened the panel onto a refusal for anyone without it — which was already
 * true of a finance account and is now true of anybody whose owner unticked
 * that one box.
 */
export function homeFor() {
  if (isAgent()) return 'dash';
  if (!isAdmin()) return 'no-access';
  return adminHome() || 'no-access';
}

export async function resolve() {
  const { page, params } = parseHash();
  const state = getState();

  if (!state.user) {
    setState({ page: 'login', params: {}, data: {} });
    return;
  }

  // Blueprint 2.8: everything is closed until the admin-set password has been
  // replaced. Enforced on the server too — this only saves the user from
  // bouncing off a refusal on every page.
  if (state.user.mustChangePassword) {
    setState({ page: 'change-password', params: {}, data: {} });
    return;
  }

  const home = homeFor();
  // An account with nothing open to it stays on the explanation, whatever is in
  // the address bar. Otherwise a leftover #dash from a previous sign-in sends it
  // to a page whose loader fails, and the answer to "why can I not get in" is a
  // stack of red boxes instead of a sentence.
  const target = home === 'no-access' ? home : page && routes.has(page) ? page : home;
  const loader = routes.get(target);

  // The first render has nothing to keep, so it shows the loading box. Every
  // navigation after it keeps the page the reader is looking at until the next
  // one is ready — see `navigating` in the store for why.
  const first = !state.page || state.page === 'login' || state.page === 'change-password';
  if (first) setState({ page: target, params, loading: true, error: null, data: {} });
  else setState({ navigating: target, error: null });

  // Two clicks in a row, and the slower loader can land last and overwrite the
  // page the reader actually asked for. The token makes a stale answer arrive
  // to a closed door.
  navToken += 1;
  const token = navToken;

  try {
    const data = loader ? await loader(params) : {};
    if (token !== navToken) return;
    setState({ page: target, params, data: data || {}, loading: false, navigating: null });
  } catch (err) {
    if (token !== navToken) return;
    setState({ page: target, params, data: {}, loading: false, navigating: null, error: err });
  }

  refreshBadges();
}

/**
 * The sidebar's numbers — open tickets, pending capacity orders.
 *
 * Off the page's critical path: a failed count must never take a working page
 * down with it. Two things keep it from also being a tax on every click.
 *
 * It is fetched at most every twenty seconds. It used to be fetched on every
 * navigation, which on a slow connection meant a second request competing with
 * the one the reader is actually waiting for, to redraw two small numbers that
 * change a few times a day.
 *
 * And `setState` is only called when a number actually moved. Every state write
 * rebuilds the whole document — that is how this renderer works — so an
 * unchanged answer arriving half a second after a page opened was a third full
 * rebuild of a screen that already looked finished, for nothing. The reader
 * feels that as the page «settling» after it has already arrived.
 */
const BADGE_TTL_MS = 20_000;
let badgesAt = 0;

/**
 * Forget the cached window, so the next navigation asks again.
 *
 * For the case where this session is what changed the number — opening the
 * notice box marks it read, and a badge that keeps saying «۲» for another
 * twenty seconds after you have read both is the panel arguing with the page
 * you are looking at.
 */
export function invalidateBadges() {
  badgesAt = 0;
}

function refreshBadges() {
  // Both menus wear numbers now, from different endpoints: an agency has no
  // moderation queue to count, and an admin has no notice box.
  const source = isAdmin() ? admin.badges : isAgent() ? notices.unread : null;
  if (!source) return;
  if (Date.now() - badgesAt < BADGE_TTL_MS) return;
  badgesAt = Date.now();

  source()
    .then((badges) => {
      const now = getState().badges;
      const same = now && Object.keys(badges).every((k) => now[k] === badges[k]);
      if (!same) setState({ badges });
    })
    .catch(() => {
      // Let the next navigation try again rather than sitting out the window.
      badgesAt = 0;
    });
}

export function startRouter() {
  window.addEventListener('hashchange', resolve);
}
