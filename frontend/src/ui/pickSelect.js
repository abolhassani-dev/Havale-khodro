import { html, raw } from './html.js';

/**
 * A select you can type in.
 *
 * The first attempt at this was a search box *above* a native select — two
 * controls for one decision, which is what the reader saw and disliked. This
 * is one control: it looks and behaves like a select, and opening it gives a
 * search box inside the same panel.
 *
 * ── Why a real <select> is still in there ───────────────────────────────────
 *
 * Hidden inside the wrapper is the ordinary native select, and it remains the
 * single source of truth: the form submits `form.brand.value`, the model list
 * is rebuilt by writing options into it, `required` still blocks an empty
 * submit, and `change` still fires exactly as before. Everything that already
 * worked keeps working; this file only adds a nicer way to set that value.
 *
 * It is visually hidden rather than `hidden`, deliberately — the browser
 * refuses to report a validation error on a control it cannot focus, so a
 * required `hidden` select fails the submit silently and forever.
 *
 * ── All DOM, no store ───────────────────────────────────────────────────────
 *
 * Same rule as the brand picker: this lives inside a form, and a re-render
 * would wipe every field the reader had typed.
 */

/**
 * @param {string} name    the form field name — also the id, as before
 * @param {Array}  options [{value, label, search}] — search is extra text to
 *                         match on (a brand's latin slug, say)
 * @param {object} [opts]
 * @param {string} [opts.placeholder]  what the closed control says when empty
 * @param {string} [opts.searchLabel]  the search box's placeholder
 * @param {boolean}[opts.required]
 * @param {boolean}[opts.disabled]
 * @param {string} [opts.value]        preselected value
 */
export function pickSelect(name, options, {
  placeholder = 'انتخاب کنید',
  searchLabel = 'جستجو…',
  required = false,
  disabled = false,
  value = '',
} = {}) {
  const chosen = options.find((o) => o.value === value);

  return html`
  <div class="pk" data-pk data-placeholder="${placeholder}">
    <select class="pk-native" id="${name}" name="${name}"
            ${raw(required ? 'required' : '')} ${raw(disabled ? 'disabled' : '')}
            tabindex="-1" aria-hidden="true">
      <option value="">${placeholder}</option>
      ${options.map(
        (o) => html`<option value="${o.value}" data-search="${o.search || ''}"
                            ${raw(o.value === value ? 'selected' : '')}>${o.label}</option>`
      )}
    </select>

    <button type="button" class="in pk-btn ${chosen ? '' : 'is-empty'}"
            data-pk-open ${raw(disabled ? 'disabled' : '')}
            aria-haspopup="listbox" aria-expanded="false">
      <span class="pk-val">${chosen ? chosen.label : placeholder}</span>
      <span class="pk-caret" aria-hidden="true"></span>
    </button>

    <div class="pk-pop" hidden data-pk-pop>
      <input class="in pk-q" type="search" data-pk-search placeholder="${searchLabel}"
             aria-label="${searchLabel}">
      <div class="pk-list" data-pk-list role="listbox">
        ${options.map(
          (o) => html`<button type="button" class="pk-opt ${o.value === value ? 'on' : ''}"
                              role="option" data-pk-pick="${o.value}"
                              data-search="${o.search || ''}">${o.label}</button>`
        )}
      </div>
      <div class="pk-none" hidden data-pk-none>چیزی پیدا نشد</div>
    </div>
  </div>`;
}

/** The wrapper an element sits in, or null. */
function wrapOf(el) {
  return el?.closest?.('[data-pk]') || null;
}

function close(wrap) {
  wrap.querySelector('[data-pk-pop]').hidden = true;
  wrap.querySelector('[data-pk-open]').setAttribute('aria-expanded', 'false');
  wrap.classList.remove('open');
}

export function closeAllPickSelects(except = null) {
  document.querySelectorAll('[data-pk].open').forEach((wrap) => {
    if (wrap !== except) close(wrap);
  });
}

/**
 * Rebuilds the visible list from the native select.
 *
 * The model select is refilled by the form's own code when a brand is chosen —
 * it writes plain <option> elements, knowing nothing about this component. So
 * after that happens the control is told to catch up, and the two can never
 * disagree about what is on offer.
 */
export function syncPickSelect(select) {
  const wrap = wrapOf(select);
  if (!wrap) return;

  const list = wrap.querySelector('[data-pk-list]');
  const button = wrap.querySelector('[data-pk-open]');
  const label = wrap.querySelector('.pk-val');
  const placeholder = wrap.dataset.placeholder;

  list.textContent = '';
  let chosenLabel = '';
  for (const option of select.options) {
    // The empty option is the placeholder, not a choice.
    if (!option.value) continue;
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `pk-opt${option.value === select.value ? ' on' : ''}`;
    item.setAttribute('role', 'option');
    item.dataset.pkPick = option.value;
    item.dataset.search = option.dataset.search || '';
    // textContent, not innerHTML: these are operator-entered names.
    item.textContent = option.textContent.trim();
    list.appendChild(item);
    if (option.value === select.value) chosenLabel = item.textContent;
  }

  button.disabled = select.disabled;
  label.textContent = chosenLabel || (select.disabled ? select.options[0]?.textContent?.trim() || placeholder : placeholder);
  button.classList.toggle('is-empty', !chosenLabel);
  wrap.querySelector('[data-pk-search]').value = '';
  wrap.querySelector('[data-pk-none]').hidden = true;
}

/** Opening, choosing, and closing. Returns true when it handled the click. */
export function handlePickSelectClick(target) {
  const wrap = wrapOf(target);

  // A click anywhere else closes whatever is open — including a click inside
  // another one of these.
  if (!wrap) {
    closeAllPickSelects();
    return false;
  }

  const opener = target.closest('[data-pk-open]');
  if (opener) {
    const pop = wrap.querySelector('[data-pk-pop]');
    const opening = pop.hidden;
    closeAllPickSelects(wrap);
    pop.hidden = !opening;
    wrap.classList.toggle('open', opening);
    opener.setAttribute('aria-expanded', String(opening));
    if (opening) {
      const q = wrap.querySelector('[data-pk-search]');
      q.value = '';
      filter(wrap, '');
      q.focus();
    }
    return true;
  }

  const pick = target.closest('[data-pk-pick]');
  if (pick) {
    const select = wrap.querySelector('.pk-native');
    select.value = pick.dataset.pkPick;
    wrap.querySelector('.pk-val').textContent = pick.textContent;
    wrap.querySelector('[data-pk-open]').classList.remove('is-empty');
    wrap.querySelectorAll('.pk-opt.on').forEach((o) => o.classList.remove('on'));
    pick.classList.add('on');
    close(wrap);
    // The form's own handlers listen for this — choosing a brand is what
    // loads its models.
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  closeAllPickSelects(wrap);
  return true;
}

function filter(wrap, q) {
  const query = q.trim().toLowerCase();
  let shown = 0;
  wrap.querySelectorAll('.pk-opt').forEach((opt) => {
    const hit =
      !query ||
      opt.textContent.toLowerCase().includes(query) ||
      (opt.dataset.search || '').toLowerCase().includes(query);
    opt.hidden = !hit;
    if (hit) shown += 1;
  });
  wrap.querySelector('[data-pk-none]').hidden = shown > 0;
}

/** Typing in the search box. Show and hide — never rebuild, never re-render. */
export function handlePickSelectSearch(input) {
  if (!input.matches?.('[data-pk-search]')) return false;
  const wrap = wrapOf(input);
  if (wrap) filter(wrap, input.value);
  return true;
}

/**
 * Enter chooses the only match, Escape closes. Typing «پژو» and pressing Enter
 * should be choosing پژو — having to reach for the mouse to confirm the one
 * remaining row is the kind of small friction that makes a form feel slow.
 */
export function handlePickSelectKey(event) {
  const wrap = wrapOf(event.target);
  if (!wrap || !event.target.matches?.('[data-pk-search]')) return false;

  if (event.key === 'Escape') {
    close(wrap);
    wrap.querySelector('[data-pk-open]').focus();
    return true;
  }
  if (event.key === 'Enter') {
    // Inside a form, Enter would otherwise submit it.
    event.preventDefault();
    const first = [...wrap.querySelectorAll('.pk-opt')].find((o) => !o.hidden);
    if (first) handlePickSelectClick(first);
    return true;
  }
  return false;
}
