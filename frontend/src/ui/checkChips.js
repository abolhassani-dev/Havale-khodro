import { html, raw } from './html.js';

/**
 * Several answers to one small question — «رنگ‌شده + تعویض‌دار» is one search.
 *
 * These are real checkboxes, not buttons that look ticked. The first version
 * was a row of toggle buttons and it read as a segmented control: an agency
 * pressed one and expected the others to switch off. A box either has a tick
 * in it or it does not, and nobody has to be told that two of them can.
 *
 * State lives in the DOM (rule 3.4): the boxes carry their own checked state
 * and one hidden input carries the comma-joined list that the filter form
 * submits and the address bar shows. Anything that went through the store
 * would re-render the page and empty every other field on the form.
 *
 * @param {string} name             the field name, and the URL parameter
 * @param {Array<[string,string]>} options  [value, label] pairs
 * @param {string} [selected]       the comma list from the address bar
 */
export function checkChips(name, options, selected) {
  const on = new Set(String(selected || '').split(',').filter(Boolean));
  return html`<div class="fchips" data-chipbox>
    <input type="hidden" name="${name}" value="${[...on].join(',')}">
    ${options.map(
      ([value, label]) => html`<label class="fchip ${on.has(value) ? 'on' : ''}">
        <input type="checkbox" data-chip="${value}" ${raw(on.has(value) ? 'checked' : '')}>
        <span>${label}</span>
      </label>`
    )}
  </div>`;
}

/**
 * A box was ticked or cleared: rewrite the hidden list and the highlight.
 * Returns true when it handled the event, for the delegated change handler.
 */
export function handleCheckChip(target) {
  if (!target?.matches?.('[data-chip]')) return false;
  const box = target.closest('[data-chipbox]');
  if (!box) return false;

  target.closest('.fchip')?.classList.toggle('on', target.checked);
  const input = box.querySelector('input[type="hidden"]');
  if (input) {
    input.value = [...box.querySelectorAll('[data-chip]:checked')]
      .map((chip) => chip.dataset.chip)
      .join(',');
  }
  return true;
}
