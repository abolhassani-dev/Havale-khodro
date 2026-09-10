/**
 * Building HTML safely.
 *
 * This file is the frontend's equivalent of the backend's masking DTO: the one
 * place a mistake would be systemic. The interface is rendered by turning data
 * into HTML strings, and every value that goes in came from somewhere a user
 * typed — an agency name, a listing description, a ticket message.
 *
 * The mockup escaped by calling `esc()` at each interpolation. That works right
 * up until somebody forgets one, and a description reading
 * `<img src=x onerror=...>` then runs as script in every viewer's session. One
 * forgotten call is the whole vulnerability.
 *
 * So the default is inverted here: `html` escapes everything it interpolates,
 * and trusted markup has to be marked as such with `raw()`. Now a mistake is a
 * visible `raw()` in the diff rather than an invisible absence.
 */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };

export function escape(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"'`]/g, (c) => ESCAPES[c]);
}

/** Marks a string as already-safe HTML. Use it only on markup you built. */
class Raw {
  constructor(value) {
    this.value = value;
  }

  toString() {
    return this.value;
  }
}

export function raw(value) {
  return new Raw(value);
}

function render(value) {
  if (value === null || value === undefined || value === false) return '';
  if (value instanceof Raw) return value.value;
  if (Array.isArray(value)) return value.map(render).join('');
  return escape(value);
}

/**
 * Tagged template for markup.
 *
 *   html`<td>${agency.name}</td>`        // escaped
 *   html`<tr>${raw(rowsMarkup)}</tr>`    // trusted, and it says so
 */
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i += 1) {
    out += render(values[i]) + strings[i + 1];
  }
  return raw(out);
}

/**
 * Attribute value for a URL, refusing anything that can execute.
 *
 * An allow-list, not a deny-list: a browser strips tabs, newlines and other
 * control characters *inside* a scheme before it reads it, so `jav\tascript:`
 * runs where a test for the word «javascript» would not have matched. The
 * same characters are stripped here first, and then only the shapes a link
 * in this product can legitimately have are let through — a relative path,
 * a fragment, a query, http(s), tel and mailto. Everything else becomes `#`.
 */
export function safeUrl(url) {
  const value = String(url ?? '').replace(/[\u0000-\u001f\u007f\s]/g, '');
  if (!/^(https?:|tel:|mailto:|\/|#|\?)/i.test(value)) return '#';
  return escape(String(url));
}
