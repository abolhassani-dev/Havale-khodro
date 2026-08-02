import { html, raw } from './html.js';
import { getState, setState } from '../state/store.js';

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
