import { html, raw } from './html.js';
import { getState, setState } from '../state/store.js';
import { closeModal } from './feedback.js';
import { errorBox } from './feedback.js';

/**
 * One modal component for three shapes: a confirmation, a form, and a read-only
 * detail panel. Three separate implementations would drift in their keyboard
 * handling and their close behaviour, and the differences would be accidental
 * rather than meant.
 */
export function renderModal() {
  const { modal } = getState();
  if (!modal) return raw('');

  const isForm = modal.type === 'form';
  const tag = isForm ? 'form' : 'div';

  return html`
  <div class="overlay" data-overlay>
    ${raw(`<${tag} class="modal ${modal.wide ? 'wide' : ''}" ${isForm ? 'data-form="modal"' : ''} role="dialog" aria-modal="true">`)}
      <div class="modal-h">
        <h3>${modal.title}</h3>
        <button class="btn sm" type="button" data-close-modal aria-label="بستن">✕</button>
      </div>
      <div class="modal-b">
        ${modal.error ? errorBox(modal.error) : ''}
        ${modal.body}
      </div>
      ${
        modal.type === 'info'
          ? html`<div class="modal-f">
              <button class="btn" type="button" data-close-modal>بستن</button>
            </div>`
          : html`<div class="modal-f">
              <button class="btn" type="button" data-close-modal>انصراف</button>
              <button class="btn ${modal.tone === 'danger' ? 'danger' : 'primary'}"
                      type="${isForm ? 'submit' : 'button'}"
                      ${raw(isForm ? '' : 'data-confirm')}>
                ${modal.confirmLabel || 'تأیید'}
              </button>
            </div>`
      }
    ${raw(`</${tag}>`)}
  </div>`;
}

/** Runs the modal's action, keeping failures inside the modal. */
export async function runModalAction(form) {
  const { modal } = getState();
  if (!modal) return;

  setState({ modal: { ...modal, error: null, busy: true } });

  try {
    if (form && modal.onSubmit) await modal.onSubmit(form);
    else if (modal.onConfirm) await modal.onConfirm();
    closeModal();
  } catch (err) {
    // Kept open with the message inside: closing it would throw away whatever
    // the user typed, and they would have to type it again to find out what was
    // wrong.
    setState({ modal: { ...getState().modal, error: err, busy: false } });
  }
}
