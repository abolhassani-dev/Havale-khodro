import { html } from '../../ui/html.js';
import { getState, setState } from '../../state/store.js';
import { auth } from '../../api/index.js';
import { toast, qtip, formErrorSlot, showFormError, clearFormError } from '../../ui/feedback.js';

/**
 * The agency's own account: who they are on the system, and their password.
 *
 * The profile fields are shown but not editable, and that is the product rule
 * rather than an omission — agency code, name and city are stamped onto every
 * listing the agency has ever posted, so changing them here would silently
 * rewrite history. They change through support, who can do it deliberately.
 */

export function profilePage() {
  const { user } = getState();
  const agency = user?.agency || {};

  return html`
  <div class="cols c2">
    <div class="card">
      <div class="card-h">
        <h2>مشخصات نمایندگی ${qtip('این مشخصات روی همه‌ی آگهی‌های شما ثبت می‌شود، پس از اینجا قابل تغییر نیست. برای اصلاح، از بخش پشتیبانی تیکت بزنید.')}</h2>
      </div>
      <div style="padding:12px 14px">
        ${row('نام و نام خانوادگی', user?.fullName)}
        ${row('نام کاربری', user?.username)}
        ${row('کد نمایندگی', agency.code)}
        ${row('نام نمایندگی', agency.name)}
        ${row('شهر', agency.city)}
        <!-- The coordinator's name and number are deliberately not here. The
             session payload does not carry them, and it should not: that file
             is the masking boundary, and widening it so one read-only row can
             be filled in is not a trade worth making. -->
        <p class="soon-note">
          برای اصلاح این مشخصات، از بخش <b>پشتیبانی</b> تیکت ثبت کنید.
        </p>
      </div>
    </div>

    <form class="card" data-form="profile-password">
      <div class="card-h">
        <h2>تغییر رمز عبور ${qtip('بعد از تغییر رمز، نشست‌های باز شما روی دستگاه‌های دیگر بسته می‌شود.')}</h2>
      </div>
      <div style="padding:12px 14px">
        ${formErrorSlot()}
        <div class="field">
          <label for="currentPassword">رمز فعلی</label>
          <input class="in" id="currentPassword" name="currentPassword" type="password"
                 autocomplete="current-password" required>
        </div>
        <div class="field">
          <label for="newPassword">رمز جدید</label>
          <input class="in" id="newPassword" name="newPassword" type="password"
                 autocomplete="new-password" minlength="8" required>
          <div class="hint">حداقل ۸ کاراکتر، شامل حرف و عدد.</div>
        </div>
        <div class="field">
          <label for="repeatPassword">تکرار رمز جدید</label>
          <input class="in" id="repeatPassword" name="repeatPassword" type="password"
                 autocomplete="new-password" minlength="8" required>
        </div>
        <button class="btn primary" type="submit">ذخیره رمز جدید</button>
      </div>
    </form>
  </div>`;
}

function row(label, value) {
  return html`<div class="drow"><span>${label}</span><b>${value || '—'}</b></div>`;
}

export async function submitProfilePassword(form) {
  const current = form.currentPassword.value;
  const next = form.newPassword.value;

  // Checked here as well as on the server, because the server cannot see the
  // repeat field — it only ever receives one new password.
  if (next !== form.repeatPassword.value) {
    showFormError(form, { message: 'رمز جدید و تکرارش یکی نیستند' });
    return;
  }

  clearFormError(form);
  try {
    await auth.changePassword(current, next);
    toast('رمز عبور تغییر کرد');
    form.reset();
  } catch (err) {
    showFormError(form, err);
  }
}
