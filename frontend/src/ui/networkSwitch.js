import { html, raw } from './html.js';

/**
 * «فقط شبکه‌ی من» — the switch on a posting form, and the badge on a card.
 *
 * One component for all three markets, because the rule is one rule: an
 * advertisement marked network-only is shown to the owner's network alone —
 * the main agency and its sub-agencies — and to nobody else in the market.
 * The server decides who is in a network and refuses the flag from anyone
 * who has none; this only decides whether to *offer* it, so an independent
 * agency never sees a setting that could not apply to it.
 *
 * Shown to a sub-agency and to a main agency alike — including a main agency
 * that has no branches yet. For that account the switch is a promise about
 * the branches it will create, and the explanation says so rather than
 * hiding the option and making the feature look absent.
 */
export function hasNetwork(user) {
  return Boolean(user && (user.parentId || user.isReseller));
}

/**
 * @param {object} user       the signed-in account
 * @param {object} [opts]
 * @param {boolean} [opts.checked]
 * @param {string}  [opts.id]   input id — the edit modal uses another, so the
 *                              page's own form and the modal never share one
 */
export function networkSwitch(user, { checked = false, id = 'visibility' } = {}) {
  if (!hasNetwork(user)) return raw('');
  const reseller = Boolean(user.isReseller && !user.parentId);
  return html`<div class="field wide net-field">
    <label class="check" for="${id}">
      <input type="checkbox" id="${id}" name="visibility" value="NETWORK" ${raw(checked ? 'checked' : '')}>
      <span><b>فقط شبکه‌ی من</b></span>
    </label>
    <div class="hint">
      با این گزینه، آگهی فقط برای شبکه‌ی خودتان — نمایندگی مرکزی و شعبه‌هایش — نمایش داده
      می‌شود و بقیه‌ی بازار آن را نمی‌بینند.
      ${reseller ? 'اگر هنوز شعبه‌ای نساخته‌اید، فعلاً فقط خودتان آن را می‌بینید.' : ''}
      هر وقت خواستید از ویرایش آگهی عوضش کنید. نمایش مشخصات برای اعضای شبکه هم مثل
      همیشه از سهمیه خرج می‌کند.
    </div>
  </div>`;
}

/** The badge a network-only advertisement wears, wherever a card is drawn. */
export function networkTag(item) {
  if (item?.visibility !== 'NETWORK') return raw('');
  return html`<span class="tag b" title="فقط نمایندگی مرکزی و شعبه‌های آن این آگهی را می‌بینند">فقط شبکه‌ی من</span>`;
}

/** What the form's checkbox says the server should store. */
export function visibilityOf(form) {
  const box = form.elements?.visibility;
  if (!box) return undefined;
  return box.checked ? 'NETWORK' : 'PUBLIC';
}
