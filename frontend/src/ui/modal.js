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
        <!-- Filled in place when a submission is refused. Empty in the markup
             on purpose: see runModalAction. -->
        <div data-modal-error>${modal.error ? errorBox(modal.error) : ''}</div>
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

/**
 * Runs the modal's action, keeping failures inside the modal.
 *
 * The refusal is written into the open modal's DOM rather than through the
 * store. It used to go through the store, and the re-render that followed
 * rebuilt the modal from its static body — so being told what was wrong cost
 * the user everything they had typed. On a form with a file on it that is not
 * a nuisance but a dead end: the second attempt submits an empty field, and
 * the browser blocks it without saying anything.
 */
export async function runModalAction(form) {
  const { modal } = getState();
  if (!modal) return;

  const root = document.querySelector('.overlay .modal');
  const slot = root?.querySelector('[data-modal-error]');
  const confirm = root?.querySelector('button[type="submit"], [data-confirm]');

  if (slot) slot.innerHTML = '';
  if (confirm) confirm.disabled = true;

  try {
    if (form && modal.onSubmit) await modal.onSubmit(form);
    else if (modal.onConfirm) await modal.onConfirm();
    closeModal();
  } catch (err) {
    if (confirm) confirm.disabled = false;
    if (slot) {
      slot.innerHTML = String(errorBox(err));
      slot.scrollIntoView({ block: 'nearest' });
      return;
    }
    // No modal in the document — the only way to say anything is the store.
    setState({ modal: { ...getState().modal, error: err } });
  }
}
