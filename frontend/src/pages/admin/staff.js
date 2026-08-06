import { html, raw } from '../../ui/html.js';
import { getState } from '../../state/store.js';
import { staff } from '../../api/index.js';
import { relative } from '../../ui/format.js';
import { emptyBox, toast, openModal, qtip } from '../../ui/feedback.js';
import { enDigits } from '../../ui/format.js';
import { resolve } from '../../router.js';

/**
 * The accounts that run the system.
 *
 * Owner only, and the whole reason it exists is the sentence "I want to tick
 * the permissions myself". So the role is a starting point rather than the
 * answer: choosing one ticks its defaults, and every box stays free to change
 * afterwards. What gets stored is only the difference — an account left on its
 * role's defaults keeps following that role when the policy changes, which is
 * the behaviour you want for the ordinary case and the one a full copy would
 * quietly break.
 *
 * The checkbox list is not written here. It comes from the server, out of the
 * same file that enforces the policy, so a permission cannot be added to the
 * rules and forgotten in this screen.
 */

const ROLE_LABEL = {
  OWNER: 'مالک',
  DEVELOPER: 'دولوپر',
  SUPER_ADMIN: 'مدیر کل',
  SUPPORT: 'پشتیبانی',
  FINANCE: 'مالی',
};

const ROLE_NOTE = {
  DEVELOPER: 'هنوز هیچ دسترسی‌ای ندارد — وقتی کسی را استخدام کردید تعیین می‌شود.',
  SUPER_ADMIN: 'همه‌ی کار روزمره. مدیریت کاربران سیستم را ندارد.',
  SUPPORT: 'تیکت و گزارش تخلف.',
  FINANCE: 'اشتراک و ظرفیت.',
};

export async function loadStaff() {
  const [list, options] = await Promise.all([staff.list(), staff.options()]);
  return { staff: list, staffOptions: options };
}

export function staffPage() {
  const { data } = getState();
  const items = data.staff?.items || [];

  return html`
  <div class="card">
    <div class="card-h">
      <h2>کاربران سیستم ${qtip('حساب‌هایی که پنل مدیریت را می‌بینند. نمایندگی‌ها اینجا نیستند — آن‌ها در بخش «نمایندگی‌ها» مدیریت می‌شوند. این صفحه فقط برای شماست و هیچ نقش دیگری آن را نمی‌بیند.')}</h2>
      <button class="btn primary" data-new-staff>کاربر جدید</button>
    </div>

    ${
      items.length
        ? html`<table>
            <thead>
              <tr>
                <th>کاربر</th><th>نقش</th><th>دسترسی‌ها</th>
                <th>وضعیت</th><th>آخرین ورود</th><th></th>
              </tr>
            </thead>
            <tbody>
              ${items.map(
                (u) => html`<tr class="${u.status === 'SUSPENDED' ? 'dim' : ''}">
                  <td>
                    <b>${u.fullName}</b>
                    <div class="sub num">${u.username}</div>
                  </td>
                  <td>
                    ${ROLE_LABEL[u.role] || u.role}
                    ${u.role === 'OWNER' ? html`<div class="sub">شما</div>` : ''}
                  </td>
                  <td>${permissionSummary(u)}</td>
                  <td>
                    <span class="tag ${u.status === 'ACTIVE' ? 'g' : 'r'}">
                      ${u.status === 'ACTIVE' ? 'فعال' : 'تعلیق'}
                    </span>
                  </td>
                  <td>${u.lastLoginAt ? relative(u.lastLoginAt) : '—'}</td>
                  <td class="row-actions">
                    ${
                      u.role === 'OWNER'
                        ? html`<span class="sub">قابل تغییر نیست</span>`
                        : html`
                            <button class="btn sm" data-edit-staff="${u.id}">ویرایش</button>
                            <button class="btn sm" data-staff-password="${u.id}">رمز جدید</button>
                            <button class="btn sm ${u.status === 'ACTIVE' ? 'danger' : ''}"
                                    data-staff-status="${u.id}"
                                    data-status="${u.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE'}">
                              ${u.status === 'ACTIVE' ? 'تعلیق' : 'فعال‌سازی'}
                            </button>`
                    }
                  </td>
                </tr>`
              )}
            </tbody>
          </table>`
        : emptyBox('هنوز کاربر سیستمی ساخته نشده است.')
    }
  </div>`;
}

/** How many boxes are ticked, and whether they match the role. */
function permissionSummary(user) {
  const on = Object.values(user.permissions || {}).filter(Boolean).length;
  if (user.role === 'OWNER') return html`<span class="sub">همه‌چیز</span>`;
  if (!on) return html`<span class="sub">هیچ دسترسی‌ای</span>`;

  return html`
    <span class="num">${on} مورد</span>
    ${user.customised ? html`<span class="tag o" style="margin-inline-start:6px">سفارشی</span>` : ''}`;
}

/**
 * The form, for a new account or an existing one.
 *
 * One function for both, because the two differ in three fields and nothing
 * else — and two nearly-identical forms is how the edit screen ends up missing
 * the checkbox that was added to the create screen.
 */
function staffForm(user) {
  const { data } = getState();
  const options = data.staffOptions || { groups: [], roles: [] };
  const editing = Boolean(user);
  const current = user?.permissions || {};

  return html`
  <div data-staff-form data-id="${user?.id || ''}">

    <div class="fields">
      ${
        editing
          ? html`<div class="field">
              <label>نام کاربری</label>
              <div class="readonly num">${user.username}</div>
            </div>`
          : html`<div class="field">
              <label for="username">نام کاربری</label>
              <input class="in num" id="username" name="username" dir="ltr" required
                     minlength="4" maxlength="40" autocomplete="off">
              <div class="hint">حروف انگلیسی، عدد، نقطه، خط تیره یا زیرخط.</div>
            </div>`
      }

      <div class="field">
        <label for="fullName">نام و نام خانوادگی</label>
        <input class="in" id="fullName" name="fullName" required value="${user?.fullName || ''}">
      </div>

      <div class="field">
        <label for="phone">شماره تماس</label>
        <input class="in num" id="phone" name="phone" dir="ltr" required
               inputmode="numeric" value="${user?.phone || ''}">
      </div>

      ${
        editing
          ? ''
          : html`<div class="field">
              <label for="password">رمز اولیه</label>
              <input class="in num" id="password" name="password" dir="ltr" required
                     minlength="10" autocomplete="new-password">
              <div class="hint">حداقل ۱۰ کاراکتر. کاربر در اولین ورود باید عوضش کند.</div>
            </div>`
      }

      <div class="field wide">
        <label for="role">نقش</label>
        <select class="in" id="role" name="role" required>
          ${options.roles.map(
            ({ role }) => html`<option value="${role}"
              ${raw(user?.role === role ? 'selected' : '')}>${ROLE_LABEL[role] || role}</option>`
          )}
        </select>
        <div class="hint" id="roleNote">
          ${ROLE_NOTE[user?.role || options.roles[0]?.role] || ''}
        </div>
        <div class="hint">
          نقش فقط تیک‌های پیش‌فرض را می‌گذارد — هر کدام را می‌توانید جداگانه عوض کنید.
        </div>
      </div>
    </div>

    <div class="perms">
      ${options.groups
        .filter((g) => !g.ownerOnly)
        .map(
          (group) => html`
        <div class="perm-group">
          <div class="perm-head">
            <b>${group.title}</b>
            <button type="button" class="btn sm" data-perm-all="${group.key}">همه</button>
            <button type="button" class="btn sm" data-perm-none="${group.key}">هیچ‌کدام</button>
          </div>
          ${group.items.map(
            (item) => html`
            <label class="perm" data-group="${group.key}">
              <input type="checkbox" name="perm:${item.key}"
                     ${raw(current[item.key] ? 'checked' : '')}>
              <span>
                <b>${item.label}</b>
                <span class="perm-hint">${item.hint}</span>
              </span>
            </label>`
          )}
        </div>`
        )}
    </div>

    <p class="soon-note" style="margin-top:10px">
      دسترسی‌های بخش «مالک» — مدیریت کاربران سیستم، هشدارها و لاگ خطا — قابل واگذاری
      نیستند و فقط روی حساب خودتان هستند.
    </p>
  </div>`;
}

export function newStaffModal() {
  openModal({
    type: 'form',
    title: 'کاربر جدید سیستم',
    wide: true,
    body: staffForm(null),
    confirmLabel: 'ساخت حساب',
    onSubmit: submitStaff,
  });
}

export function editStaffModal(id) {
  const user = (getState().data.staff?.items || []).find((u) => u.id === id);
  if (!user) return;

  openModal({
    type: 'form',
    title: `ویرایش ${user.fullName}`,
    wide: true,
    body: staffForm(user),
    confirmLabel: 'ذخیره',
    onSubmit: submitStaff,
  });
}

/** Reads the ticked boxes back out of the form. */
function readPermissions(form) {
  const out = {};
  form.querySelectorAll('input[type=checkbox][name^="perm:"]').forEach((box) => {
    out[box.name.slice(5)] = box.checked;
  });
  return out;
}

export async function submitStaff(form) {
  // The id lives on the wrapper the modal put this body inside.
  const holder = form.querySelector('[data-staff-form]');
  const id = holder?.dataset.id || '';

  const payload = {
    fullName: form.fullName.value.trim(),
    phone: enDigits(form.phone.value.trim()),
    role: form.role.value,
    permissions: readPermissions(form),
  };

  // Thrown rather than caught: the modal keeps itself open and shows the
  // message, so whatever was typed and ticked is still there to correct.
  if (id) {
    await staff.update(id, payload);
    toast('تغییرات ذخیره شد');
  } else {
    await staff.create({
      ...payload,
      username: form.username.value.trim(),
      password: form.password.value,
    });
    toast('حساب ساخته شد');
  }
  await resolve();
}

export function staffPasswordModal(id) {
  const user = (getState().data.staff?.items || []).find((u) => u.id === id);
  if (!user) return;

  openModal({
    title: `رمز جدید برای ${user.fullName}`,
    type: 'form',
    body: html`
      <p>نشست‌های باز این کاربر بسته می‌شود و در ورود بعدی باید رمز را عوض کند.</p>
      <div class="field">
        <label for="newStaffPassword">رمز جدید</label>
        <input class="in num" id="newStaffPassword" name="password" dir="ltr"
               required minlength="10" autocomplete="new-password">
      </div>`,
    confirmLabel: 'ذخیره',
    onSubmit: async (form) => {
      await staff.setPassword(id, form.password.value);
      toast('رمز عوض شد');
    },
  });
}

export async function setStaffStatus(id, status) {
  try {
    await staff.update(id, { status });
    toast(status === 'SUSPENDED' ? 'حساب تعلیق شد' : 'حساب فعال شد');
    await resolve();
  } catch (err) {
    toast(err.message, 'danger');
  }
}

/**
 * Ticking a whole group, and re-applying a role's defaults when it changes.
 *
 * Wired from the app's one change listener rather than inline handlers — the
 * modal is replaced on every render, so anything bound to an element would be
 * bound to an element that no longer exists.
 */
export function onStaffFormChange(target) {
  const form = target.form;
  if (target.name !== 'role') return;
  // Identified by the wrapper this page puts in the modal body, not by the
  // form's own `data-form` — every modal form carries `data-form="modal"`, so
  // checking that name would have matched nothing and the role dropdown would
  // have silently stopped re-ticking anything.
  if (!form?.querySelector('[data-staff-form]')) return;

  const { data } = getState();
  const preset = (data.staffOptions?.roles || []).find((r) => r.role === target.value);
  if (!preset) return;

  // The role is a starting point, so changing it re-ticks its defaults. Anything
  // the reader had already changed is replaced, which is what "choose a role"
  // should mean — otherwise the boxes and the label disagree and the label wins
  // in everybody's memory.
  form.querySelectorAll('input[type=checkbox][name^="perm:"]').forEach((box) => {
    box.checked = Boolean(preset.defaults[box.name.slice(5)]);
  });

  const note = form.querySelector('#roleNote');
  if (note) note.textContent = ROLE_NOTE[target.value] || '';
}

export function toggleGroup(form, groupKey, checked) {
  form.querySelectorAll(`.perm[data-group="${groupKey}"] input[type=checkbox]`)
    .forEach((box) => { box.checked = checked; });
}

export { ROLE_LABEL };
