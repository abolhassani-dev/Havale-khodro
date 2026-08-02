import { html } from '../ui/html.js';
import { auth } from '../api/index.js';
import { setState, getState } from '../state/store.js';
import { errorBox, toast } from '../ui/feedback.js';
import { BRAND, LIMITS } from '../constants.js';
import { go, homeFor, resolve } from '../router.js';
import { boot } from '../session.js';

/** Sign-in, and the forced password change that follows a first sign-in. */

export function loginPage() {
  const { error } = getState();

  return html`
  <div class="auth">
    <form class="authbox" data-form="login">
      <div class="head">
        <img class="logo" src="/assets/logo.svg" alt="نشان فرانوکار">
        <h1>${BRAND.nameFa}</h1>
        <p>${BRAND.tagline}</p>
      </div>
      <div class="body">
        ${errorBox(error)}
        <div class="field">
          <label for="username">نام کاربری</label>
          <input class="in" id="username" name="username" dir="ltr" autocomplete="username"
                 required autofocus>
        </div>
        <div class="field">
          <label for="password">رمز عبور</label>
          <input class="in" id="password" name="password" type="password" dir="ltr"
                 autocomplete="current-password" required>
        </div>
        <button class="btn primary" type="submit" style="padding:10px">ورود به سامانه</button>
        <div style="font-size:11.5px;color:var(--ink-3);text-align:center">
          رمز را فراموش کرده‌اید؟ با پشتیبانی تماس بگیرید.
        </div>
      </div>
      <div class="foot">هر حساب همزمان فقط یک نشست فعال دارد</div>
    </form>
  </div>`;
}

export async function submitLogin(form) {
  const username = form.username.value.trim();
  const password = form.password.value;

  setState({ error: null });

  try {
    await auth.login(username, password);
    // Re-reads the session from the server rather than trusting the login
    // response, so one code path decides what a signed-in user looks like.
    await boot();
    go(homeFor());
    await resolve();
  } catch (err) {
    setState({ error: err });
  }
}

export function changePasswordPage() {
  const { error, user } = getState();
  const forced = Boolean(user?.mustChangePassword);

  return html`
  <div class="auth">
    <form class="authbox" data-form="change-password">
      <div class="head">
        <div class="glyph">⚿</div>
        <h1>تغییر رمز عبور</h1>
        <p>${forced ? 'برای ادامه باید رمز عبور را عوض کنید' : 'رمز تازه انتخاب کنید'}</p>
      </div>
      <div class="body">
        ${
          forced
            ? html`<div class="banner">
                <span class="b-ico">ⓘ</span>
                <div class="b-txt">
                  رمز فعلی را شخص دیگری تعیین کرده و از آن خبر دارد. تا وقتی عوضش نکنید،
                  بقیه‌ی بخش‌های سامانه باز نمی‌شود.
                </div>
              </div>`
            : ''
        }
        ${errorBox(error)}
        <div class="field">
          <label for="current">رمز فعلی</label>
          <input class="in" id="current" name="currentPassword" type="password" dir="ltr"
                 autocomplete="current-password" required>
        </div>
        <div class="field">
          <label for="next">رمز جدید</label>
          <input class="in" id="next" name="newPassword" type="password" dir="ltr"
                 autocomplete="new-password" minlength="${LIMITS.passwordMin}" required>
          <div class="hint">حداقل ${LIMITS.passwordMin} کاراکتر</div>
        </div>
        <div class="field">
          <label for="repeat">تکرار رمز جدید</label>
          <input class="in" id="repeat" name="repeat" type="password" dir="ltr"
                 autocomplete="new-password" required>
        </div>
        <button class="btn primary" type="submit" style="padding:10px">ثبت رمز جدید</button>
      </div>
      <div class="foot">با تغییر رمز، همه‌ی نشست‌های دیگر بسته می‌شوند</div>
    </form>
  </div>`;
}

export async function submitChangePassword(form) {
  const currentPassword = form.currentPassword.value;
  const newPassword = form.newPassword.value;

  // Checked here only to save a round trip and give an instant answer; the
  // server enforces everything that matters.
  if (newPassword !== form.repeat.value) {
    setState({ error: { message: 'دو رمز جدید یکسان نیستند' } });
    return;
  }

  setState({ error: null });

  try {
    await auth.changePassword(currentPassword, newPassword);
    await boot();
    toast('رمز عبور تغییر کرد');
    go(homeFor());
    await resolve();
  } catch (err) {
    setState({ error: err });
  }
}
