import { html, raw } from './html.js';
import { getState, setState } from '../state/store.js';
import { faDigits } from './format.js';
import { MAX_PAGE } from '../constants.js';

/** Transient messages and the modal layer. */

let toastTimer = null;

export function toast(message, tone = 'ok') {
  clearTimeout(toastTimer);
  setState({ toast: { message, tone } });
  toastTimer = setTimeout(() => setState({ toast: null }), 4000);
}

export function openModal(modal) {
  setState({ modal });
}

export function closeModal() {
  setState({ modal: null });
}

export function renderToast() {
  const { toast: current } = getState();
  if (!current) return raw('');
  return html`<div class="toast ${current.tone}">${current.message}</div>`;
}

/**
 * A failure the user can act on.
 *
 * The API's own message is shown rather than a generic one: the server already
 * says "your daily allowance is used up" or "this listing is not yours", and
 * replacing that with "something went wrong" throws away the only useful part.
 */
export function errorBox(error) {
  if (!error) return raw('');

  const details = Array.isArray(error.details)
    ? error.details.map((d) => html`<li>${d.message}</li>`)
    : null;

  return html`<div class="banner danger">
    <span class="b-ico">✕</span>
    <div class="b-txt">
      <b>${error.message}</b>
      ${details ? html`<ul style="margin-top:4px">${details}</ul>` : ''}
    </div>
  </div>`;
}

/**
 * Where a form puts the reason its submission was refused.
 *
 * An empty slot in the markup, filled by `showFormError` afterwards. It has to
 * work this way round: `render()` rebuilds the page by replacing innerHTML, so
 * routing a form error through the store re-creates every input as an empty
 * one. The user is told what was wrong and, in the same instant, loses
 * everything they had typed — which is worse than not being told.
 *
 * Writing into the slot leaves the form untouched.
 */
export function formErrorSlot() {
  return raw('<div class="errslot" data-err hidden></div>');
}

export function showFormError(form, error) {
  const slot = form?.querySelector('[data-err]');
  if (!slot) return;

  const details = Array.isArray(error?.details) ? error.details : [];
  slot.hidden = false;
  // Built with the DOM rather than innerHTML: these strings come back from the
  // server carrying values the user typed.
  slot.replaceChildren();
  const box = document.createElement('div');
  box.className = 'banner danger';
  const ico = document.createElement('span');
  ico.className = 'b-ico';
  ico.textContent = '✕';
  const txt = document.createElement('div');
  txt.className = 'b-txt';
  const b = document.createElement('b');
  b.textContent = error?.message || 'خطا';
  txt.append(b);
  if (details.length) {
    const ul = document.createElement('ul');
    ul.style.marginTop = '4px';
    details.forEach((d) => {
      const li = document.createElement('li');
      li.textContent = d.message || String(d);
      ul.append(li);
    });
    txt.append(ul);
  }
  box.append(ico, txt);
  slot.append(box);
  slot.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

export function clearFormError(form) {
  const slot = form?.querySelector('[data-err]');
  if (!slot) return;
  slot.hidden = true;
  slot.replaceChildren();
}

export function loadingBox() {
  return html`<div class="empty">در حال بارگذاری…</div>`;
}

export function emptyBox(message) {
  return html`<div class="empty">${message}</div>`;
}

/** A labelled row, used throughout the detail modals. */
export function detailRow(label, value) {
  return html`<div class="drow"><span>${label}</span><b>${value}</b></div>`;
}

/**
 * The little «؟» beside a section title.
 *
 * The explanation lives in the interface so nobody has to be trained on it —
 * a new agency reads what a section is for at the moment they are looking at
 * it, not in a manual. Pure CSS on hover and keyboard focus; tabindex so it
 * works without a mouse.
 */
export function qtip(text) {
  return html`<span class="qtip" tabindex="0" role="note" aria-label="راهنما">؟<span class="tip">${text}</span></span>`;
}

/**
 * Numbered pages: «قبلی ۱ … ۴ ۵ ۶ … ۱۲ بعدی».
 *
 * A windowed pager, because a thousand records must not become a thousand
 * buttons any more than one endless list. First and last page are always
 * reachable; the window slides with the current page.
 *
 * `params` are the filters to carry along — every button re-enters the same
 * route with the same filters and only the page changed.
 */
export function pager({ page = 1, pages = 1, go: target, params = {}, maxPage = MAX_PAGE }) {
  // The honest total, and the deepest page anybody may actually ask for. Past
  // the market cap the server answers 422, so the pager must not offer the
  // button. `maxPage` is raised only by screens whose endpoint takes skip/take
  // and has no such rule — the admin timeline, where paging back through the
  // record is the whole job.
  const capped = pages > maxPage;
  const last = capped ? maxPage : pages;
  if (!last || last <= 1) return raw('');

  const query = (p) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') q.set(key, value);
    });
    q.set('page', p);
    return q.toString();
  };
  const link = (p, label) =>
    html`<button class="pg" data-go="${target}" data-go-params="${query(p)}">${label}</button>`;

  const numbers = [];
  for (let p = 1; p <= last; p += 1) {
    if (p === 1 || p === last || Math.abs(p - page) <= 2) numbers.push(p);
  }

  const parts = [];
  let previous = 0;
  for (const p of numbers) {
    if (p - previous > 1) parts.push(html`<span class="pg-dots">…</span>`);
    parts.push(p === page ? html`<span class="pg on">${faDigits(p)}</span>` : link(p, faDigits(p)));
    previous = p;
  }

  return html`<nav class="pager">
    ${page > 1 ? link(page - 1, 'قبلی') : ''}
    ${parts}
    ${page < last ? link(page + 1, 'بعدی') : ''}
  </nav>
  ${
    // Only once the reader is actually standing on the last page they can
    // reach. Said earlier it would be a warning about a wall nobody is walking
    // towards; said here it answers the question they are about to ask.
    capped && page >= last
      ? html`<div class="hint pg-end">
          این آخرین صفحه‌ای است که نمایش داده می‌شود
          (${faDigits(last)} صفحه از ${faDigits(pages)}).
          برای رسیدن به بقیه‌ی موارد، فیلترها را باریک‌تر کنید.
        </div>`
      : ''
  }`;
}
