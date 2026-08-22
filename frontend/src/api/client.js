/**
 * The one place that talks to the API.
 *
 * Every request carries the session cookie and nothing else — there is no token
 * in localStorage, because a token JavaScript can read is a token an XSS bug can
 * steal. The cookie is httpOnly, so this file never sees it and cannot leak it.
 */

const BASE = window.__API_BASE__ || '/api/v1';

/** Errors the API returned, carrying the machine-readable code the UI branches on. */
export class ApiError extends Error {
  constructor({ message, code, status, details }) {
    super(message || 'خطای غیرمنتظره');
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const listeners = { unauthenticated: [], kicked: [], suspended: [] };

export function on(event, handler) {
  listeners[event].push(handler);
}

function emit(event, payload) {
  listeners[event].forEach((handler) => handler(payload));
}

async function request(method, path, { body, query } = {}) {
  const url = new URL(BASE + path, window.location.origin);
  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, value);
      }
    });
  }

  let response;
  try {
    // FormData goes as-is: the browser writes the multipart boundary into the
    // Content-Type itself, and setting the header by hand would corrupt it.
    const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
    response = await fetch(url, {
      method,
      // Without this the browser sends no cookie and every request is anonymous.
      credentials: 'include',
      headers: body && !isForm ? { 'Content-Type': 'application/json' } : {},
      body: isForm ? body : body ? JSON.stringify(body) : undefined,
    });
  } catch {
    // A network failure is not an API error and must not be reported as one —
    // "server said no" and "could not reach the server" need different advice.
    throw new ApiError({ message: 'ارتباط با سرور برقرار نشد. اتصال اینترنت را بررسی کنید.', code: 'NETWORK' });
  }

  if (response.status === 204) return null;

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const error = new ApiError({
      message: payload?.error?.message,
      code: payload?.error?.code,
      status: response.status,
      details: payload?.error?.details,
    });

    // These three are not errors a page should handle on its own: they mean the
    // session is over, and the whole app has to react. Announcing them centrally
    // is what stops every call site having to remember.
    if (error.code === 'SESSION_KICKED') emit('kicked', error);
    else if (response.status === 401) emit('unauthenticated', error);
    else if (response.status === 403 && error.message?.includes('تعلیق')) emit('suspended', error);

    throw error;
  }

  return payload?.data ?? null;
}

export const api = {
  get: (path, query) => request('GET', path, { query }),
  post: (path, body) => request('POST', path, { body }),
  put: (path, body) => request('PUT', path, { body }),
  patch: (path, body) => request('PATCH', path, { body }),
  delete: (path) => request('DELETE', path),
};
