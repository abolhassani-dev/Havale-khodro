import { html, raw } from '../../ui/html.js';
import { admin } from '../../api/index.js';
import { getState } from '../../state/store.js';
import { faDigits } from '../../ui/format.js';
import { emptyBox, toast, openModal } from '../../ui/feedback.js';
import { resolve } from '../../router.js';

/**
 * Editing the car catalogue.
 *
 * There is no delete button anywhere on this screen, on purpose. A model that
 * has been used is referenced by listings, reveal records and violation
 * reports — removing it would take that history with it. "Removing a car" here
 * means retiring it: no new listing can use it, everything already posted stays
 * exactly as it was.
 */

export async function loadAdminCatalog() {
  return { catalog: await admin.catalog() };
}

export function catalogPage() {
  const { data } = getState();
  const companies = data.catalog?.companies || [];
  const colors = data.catalog?.colors || [];

  return html`
  <div class="card">
    <div class="card-h">
      <h2>کاتالوگ خودرو</h2>
      <div style="display:flex;gap:8px">
        <button class="btn sm" data-new-company>شرکت جدید</button>
        <button class="btn sm" data-new-brand>برند جدید</button>
        <button class="btn primary sm" data-new-model>مدل جدید</button>
      </div>
    </div>

    <div class="hint" style="padding:8px 14px">
      «حذف» وجود ندارد و نباید داشته باشد: مدلی که استفاده شده در آگهی‌ها و گزارش‌های تخلف
      ارجاع دارد. برای برداشتن یک خودرو، <b>غیرفعالش کنید</b> — آگهی جدید با آن ثبت نمی‌شود
      و آگهی‌های موجود سالم می‌مانند.
    </div>

    ${
      companies.length
        ? companies.map(companyBlock)
        : emptyBox('کاتالوگ خالی است. ابتدا یک شرکت بسازید.')
    }
  </div>

  <div class="card">
    <div class="card-h">
      <h2>رنگ‌ها</h2>
      <button class="btn primary sm" data-new-color>رنگ جدید</button>
    </div>
    <table>
      <thead><tr><th>نام</th><th>ترتیب</th><th>وضعیت</th><th></th></tr></thead>
      <tbody>
        ${colors.map(
          (c) => html`<tr class="${c.isActive ? '' : 'dim'}">
            <td>${c.name}</td>
            <td class="num">${faDigits(c.sortOrder)}</td>
            <td>${activeTag(c.isActive)}</td>
            <td class="row-actions">
              <button class="btn sm" data-edit-color="${c.id}" data-name="${c.name}"
                      data-order="${c.sortOrder}">ویرایش</button>
              <button class="btn sm" data-toggle-color="${c.id}" data-active="${c.isActive}">
                ${c.isActive ? 'غیرفعال' : 'فعال'}
              </button>
            </td>
          </tr>`
        )}
      </tbody>
    </table>
  </div>`;
}

function companyBlock(company) {
  return html`
  <div class="cat-company ${company.isActive ? '' : 'dim'}">
    <div class="cat-h">
      <h3>${company.name} <span class="num sub">${company.slug}</span></h3>
      <div class="row-actions">
        ${activeTag(company.isActive)}
        <button class="btn sm" data-edit-company="${company.id}" data-name="${company.name}"
                data-order="${company.sortOrder}">ویرایش</button>
        <button class="btn sm" data-toggle-company="${company.id}" data-active="${company.isActive}">
          ${company.isActive ? 'غیرفعال' : 'فعال'}
        </button>
      </div>
    </div>

    ${company.brands.map((brand) => brandBlock(brand))}
  </div>`;
}

function brandBlock(brand) {
  return html`
  <div class="cat-brand ${brand.isActive ? '' : 'dim'}">
    <div class="cat-h">
      <h4>${brand.name} <span class="sub">${faDigits(brand.models.length)} مدل</span></h4>
      <div class="row-actions">
        ${activeTag(brand.isActive)}
        <button class="btn sm" data-edit-brand="${brand.id}" data-name="${brand.name}"
                data-order="${brand.sortOrder}">ویرایش</button>
        <button class="btn sm" data-toggle-brand="${brand.id}" data-active="${brand.isActive}">
          ${brand.isActive ? 'غیرفعال' : 'فعال'}
        </button>
      </div>
    </div>

    <table>
      <thead><tr><th>مدل</th><th>ترتیب</th><th>وضعیت</th><th></th></tr></thead>
      <tbody>
        ${brand.models.map(
          (model) => html`<tr class="${model.isActive ? '' : 'dim'}">
            <td>${model.name}</td>
            <td class="num">${faDigits(model.sortOrder)}</td>
            <td>${activeTag(model.isActive)}</td>
            <td class="row-actions">
              <button class="btn sm" data-edit-model="${model.id}" data-name="${model.name}"
                      data-order="${model.sortOrder}">ویرایش</button>
              <button class="btn sm" data-toggle-model="${model.id}" data-active="${model.isActive}"
                      data-name="${model.name}">
                ${model.isActive ? 'غیرفعال' : 'فعال'}
              </button>
            </td>
          </tr>`
        )}
      </tbody>
    </table>
  </div>`;
}

function activeTag(isActive) {
  return isActive
    ? html`<span class="tag g">فعال</span>`
    : html`<span class="tag">بازنشسته</span>`;
}

// ── actions ─────────────────────────────────────────────────────────────────

export function handleCatalogClick(d) {
  if (d.newCompany !== undefined) return newCompanyModal();
  if (d.newBrand !== undefined) return newBrandModal();
  if (d.newModel !== undefined) return newModelModal();
  if (d.newColor !== undefined) return newColorModal();

  if (d.editCompany) return editModal('company', d.editCompany, d.name, d.order);
  if (d.editBrand) return editModal('brand', d.editBrand, d.name, d.order);
  if (d.editModel) return editModal('model', d.editModel, d.name, d.order);
  if (d.editColor) return editModal('color', d.editColor, d.name, d.order);

  if (d.toggleCompany) return toggle('company', d.toggleCompany, d.active !== 'true');
  if (d.toggleBrand) return toggle('brand', d.toggleBrand, d.active !== 'true');
  if (d.toggleModel) return toggleModel(d.toggleModel, d.active !== 'true', d.name);
  if (d.toggleColor) return toggle('color', d.toggleColor, d.active !== 'true');

  return undefined;
}

export function handleCatalogSubmit() {
  return undefined;
}

const UPDATERS = {
  company: admin.updateCompany,
  brand: admin.updateBrand,
  model: admin.updateModel,
  color: admin.updateColor,
};

const LABELS = { company: 'شرکت', brand: 'برند', model: 'مدل', color: 'رنگ' };

function editModal(kind, id, name, order) {
  openModal({
    type: 'form',
    title: `ویرایش ${LABELS[kind]}`,
    body: html`
      <div class="field">
        <label for="c-name">نام</label>
        <input class="in" id="c-name" name="name" value="${name}" required>
      </div>
      <div class="field">
        <label for="c-order">ترتیب نمایش</label>
        <input class="in num" id="c-order" name="sortOrder" inputmode="numeric" value="${order}">
      </div>
      <p style="color:var(--ink-3);font-size:12px">
        تغییر نام روی آگهی‌های قبلی اثر ندارد — هر آگهی نام لحظه‌ی ثبتش را نگه داشته است.
      </p>`,
    confirmLabel: 'ثبت',
    onSubmit: async (form) => {
      await UPDATERS[kind](id, {
        name: form.name.value.trim(),
        sortOrder: Number(form.sortOrder.value || 0),
      });
      toast('به‌روز شد');
      await resolve();
    },
  });
}

async function toggle(kind, id, isActive) {
  try {
    await UPDATERS[kind](id, { isActive });
    toast(isActive ? 'فعال شد' : 'بازنشسته شد');
    await resolve();
  } catch (err) {
    toast(err.message, 'danger');
  }
}

/**
 * Retiring a model says how many listings already use it, before it happens.
 *
 * Nobody should discover the size of a change after making it.
 */
async function toggleModel(id, isActive, name) {
  if (isActive) return toggle('model', id, true);

  let usage = null;
  try {
    usage = await admin.modelUsage(id);
  } catch {
    // Not being able to count is not a reason to block the action; the warning
    // just becomes less specific.
  }

  openModal({
    type: 'confirm',
    title: `بازنشسته کردن «${name}»`,
    body: html`
      <p>پس از این، هیچ آگهی جدیدی با این مدل ثبت نمی‌شود.</p>
      ${
        usage
          ? html`<p><b class="num">${faDigits(usage.havales)}</b> آگهی از قبل با این مدل ثبت شده —
              همه‌شان دست‌نخورده و قابل مشاهده باقی می‌مانند.</p>`
          : ''
      }`,
    confirmLabel: 'بازنشسته کن',
    onConfirm: () => toggle('model', id, false),
  });
}

function newCompanyModal() {
  openModal({
    type: 'form',
    title: 'شرکت جدید',
    body: html`
      ${nameField()}
      ${slugField()}`,
    confirmLabel: 'بساز',
    onSubmit: async (form) => {
      await admin.createCompany({ name: form.name.value.trim(), slug: form.slug.value.trim() });
      toast('شرکت اضافه شد');
      await resolve();
    },
  });
}

function newBrandModal() {
  const { data } = getState();
  const companies = data.catalog?.companies || [];

  openModal({
    type: 'form',
    title: 'برند جدید',
    body: html`
      <div class="field">
        <label for="c-company">شرکت</label>
        <select class="in" id="c-company" name="companyId" required>
          ${companies.map((c) => html`<option value="${c.id}">${c.name}</option>`)}
        </select>
      </div>
      ${nameField()}
      ${slugField()}`,
    confirmLabel: 'بساز',
    onSubmit: async (form) => {
      await admin.createBrand({
        companyId: form.companyId.value,
        name: form.name.value.trim(),
        slug: form.slug.value.trim(),
      });
      toast('برند اضافه شد');
      await resolve();
    },
  });
}

function newModelModal() {
  const { data } = getState();
  const brands = (data.catalog?.companies || []).flatMap((c) =>
    c.brands.map((b) => ({ ...b, company: c.name }))
  );

  openModal({
    type: 'form',
    title: 'مدل جدید',
    body: html`
      <div class="field">
        <label for="c-brand">برند</label>
        <select class="in" id="c-brand" name="brandId" required>
          ${brands.map((b) => html`<option value="${b.id}">${b.company} — ${b.name}</option>`)}
        </select>
      </div>
      ${nameField('نام کامل مدل، همان‌طور که نماینده می‌بیند')}
      <div class="field">
        <label for="c-order">ترتیب نمایش</label>
        <input class="in num" id="c-order" name="sortOrder" inputmode="numeric" value="0">
      </div>`,
    confirmLabel: 'بساز',
    onSubmit: async (form) => {
      await admin.createModel({
        brandId: form.brandId.value,
        name: form.name.value.trim(),
        sortOrder: Number(form.sortOrder.value || 0),
      });
      toast('مدل اضافه شد');
      await resolve();
    },
  });
}

function newColorModal() {
  openModal({
    type: 'form',
    title: 'رنگ جدید',
    body: nameField(),
    confirmLabel: 'بساز',
    onSubmit: async (form) => {
      await admin.createColor({ name: form.name.value.trim() });
      toast('رنگ اضافه شد');
      await resolve();
    },
  });
}

function nameField(hint) {
  return html`<div class="field">
    <label for="c-name">نام</label>
    <input class="in" id="c-name" name="name" required>
    ${hint ? html`<div class="hint">${hint}</div>` : ''}
  </div>`;
}

function slugField() {
  return html`<div class="field">
    <label for="c-slug">شناسه‌ی انگلیسی</label>
    <input class="in" id="c-slug" name="slug" dir="ltr" pattern="[a-z0-9-]+" required>
    <div class="hint">فقط حروف کوچک انگلیسی، عدد و خط تیره — مثل <span dir="ltr">fownix</span></div>
  </div>`;
}
