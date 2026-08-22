import { getState, setState, isAdmin, isAgent } from './state/store.js';
import { adminHome } from './ui/shell.js';
import { admin } from './api/index.js';

/**
 * Routing on the hash.
 *
 * The hash rather than the History API for one practical reason: nginx serves
 * this as static files, and a real path like /havales/123 would 404 on refresh
 * unless every route is rewritten server-side. A hash never reaches the server,
 * so refresh and deep links work with no server configuration to get wrong.
 */

const routes = new Map();

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

  setState({ page: target, params, loading: true, error: null, data: {} });

  try {
    const data = loader ? await loader(params) : {};
    setState({ data: data || {}, loading: false });
  } catch (err) {
    setState({ loading: false, error: err });
  }

  // The sidebar's numbers — open tickets, pending capacity orders — refresh
  // with every navigation, off the page's critical path: a failed count must
  // never take a working page down with it.
  if (isAdmin()) {
    admin
      .badges()
      .then((badges) => setState({ badges }))
      .catch(() => {});
  }
}

export function startRouter() {
  window.addEventListener('hashchange', resolve);
}
