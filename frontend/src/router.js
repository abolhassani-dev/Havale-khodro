import { getState, setState, isAdmin } from './state/store.js';

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

/** Where somebody lands when they arrive with no route. */
export function homeFor() {
  return isAdmin() ? 'adm-dash' : 'dash';
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

  const target = page && routes.has(page) ? page : homeFor();
  const loader = routes.get(target);

  setState({ page: target, params, loading: true, error: null, data: {} });

  try {
    const data = loader ? await loader(params) : {};
    setState({ data: data || {}, loading: false });
  } catch (err) {
    setState({ loading: false, error: err });
  }
}

export function startRouter() {
  window.addEventListener('hashchange', resolve);
}
