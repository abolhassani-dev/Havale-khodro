import { html, raw } from '../../ui/html.js';
import { admin } from '../../api/index.js';
import { getState, setState } from '../../state/store.js';
import { faDigits } from '../../ui/format.js';
import { emptyBox, toast, openModal , qtip } from '../../ui/feedback.js';
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

/**
 * The brand filter's text.
 *
 * In the store rather than in the URL, because the alternative is re-running
 * the page loader — a fresh catalogue fetch — on every keystroke. The brands
 * are already here; filtering them is the browser's job.
 */
export function setCatalogQuery(q) {
  const { data } = getState();
  setState({ data: { ...data, catalogQuery: q } });
}

export function catalogPage() {
  const { data } = getState();
  const companies = data.catalog?.companies || [];
  const brands = data.catalog?.brands || [];
  const colors = data.catalog?.colors || [];
  const query = (data.catalogQuery || '').trim();

  // 186 brands is too many to read, and the answer to "where is پژو" should be
  // typing پژو rather than scrolling. Matching the slug too means the Latin
  // name works — somebody who knows it as `peugeot` finds it.
  const shown = query
    ? brands.filter((b) => b.name.includes(query) || b.slug.includes(query.toLowerCase()))
    : brands;

  // Grouped by company, with the ungrouped ones last and named. They are the
  // majority and that is expected, not a backlog: the market list this came
  // from has no manufacturer level, and a brand nobody has filed is fully
  // usable where it stands.
  const groups = companies
    .map((c) => ({ company: c, items: shown.filter((b) => b.companyId === c.id) }))
    .filter((g) => g.items.length);

  const ungrouped = shown.filter((b) => !b.companyId);

  return html`
  <div class="card">
    <div class="card-h">
      <h2>کاتالوگ خودرو ${qtip('برندها و مدل‌هایی که نمایندگی‌ها موقع ثبت حواله از بینشان انتخاب می‌کنند. شرکت فقط برای دسته‌بندی است و اجباری نیست — برندی که شرکتش را نمی‌دانید زیر «دسته‌بندی‌نشده» می‌ماند و کاملاً کار می‌کند. مدل استفاده‌شده حذف نمی‌شود؛ غیرفعالش کنید تا از فرم ثبت بیفتد و آگهی‌های قبلی سالم بمانند.')}</h2>
      <div style="display:flex;gap:8px">
        <button class="btn sm" data-new-company>شرکت جدید</button>
        <button class="btn sm" data-new-brand>برند جدید</button>
        <button class="btn primary sm" data-new-model>مدل جدید</button>
      </div>
    </div>

    <div class="filters">
      <div class="field" style="flex:1">
        <label for="catq">جستجوی برند</label>
        <input class="in" id="catq" name="q" value="${query}" placeholder="مثلاً پژو یا peugeot"
               data-catalog-search>
      </div>
      <div class="hint" style="align-self:end;padding-bottom:9px">
        ${faDigits(shown.length)} از ${faDigits(brands.length)} برند
      </div>
    </div>

    <div class="hint" style="padding:8px 14px">
      «حذف» وجود ندارد و نباید داشته باشد: مدلی که استفاده شده در آگهی‌ها و گزارش‌های تخلف
      ارجاع دارد. برای برداشتن یک خودرو، <b>غیرفعالش کنید</b> — آگهی جدید با آن ثبت نمی‌شود
      و آگهی‌های موجود سالم می‌مانند.
    </div>

    ${
      shown.length
        ? html`
          ${groups.map(
            (g) => html`<div class="cat-company ${g.company.isActive ? '' : 'dim'}">
              <div class="cat-h">
                <h3>${g.company.name} <span class="num sub">${g.company.slug}</span></h3>
                <div class="row-actions">
                  ${activeTag(g.company.isActive)}
                  <button class="btn sm" data-edit-company="${g.company.id}"
                          data-name="${g.company.name}" data-order="${g.company.sortOrder}">ویرایش</button>
                  <button class="btn sm" data-toggle-company="${g.company.id}"
                          data-active="${g.company.isActive}">
                    ${g.company.isActive ? 'غیرفعال' : 'فعال'}
                  </button>
                </div>
              </div>
              ${g.items.map(brandBlock)}
            </div>`
          )}

          ${
            ungrouped.length
              ? html`<div class="cat-company">
                  <div class="cat-h">
                    <h3>دسته‌بندی‌نشده <span class="sub">${faDigits(ungrouped.length)} برند</span></h3>
                  </div>
                  <div class="hint" style="padding:0 14px 8px">
                    شرکت سازنده‌شان تعیین نشده. لازم هم نیست — با «ویرایش» هر وقت خواستید
                    شرکتش را مشخص کنید.
                  </div>
                  ${ungrouped.map(brandBlock)}
                </div>`
              : ''
          }`
        : emptyBox(query ? 'برندی با این نام پیدا نشد.' : 'کاتالوگ خالی است.')
    }
  </div>

  <div class="card">
    <div class="card-h">
      <h2>رنگ‌ها ${qtip('رنگ‌هایی که در فرم ثبت حواله پیشنهاد می‌شوند. «ترتیب» جای رنگ در فهرست را تعیین می‌کند.')}</h2>
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

/**
 * One brand, with its models only once somebody asks for them.
 *
 * Opening a brand fetches its models; until then the row shows a count. The
 * whole catalogue used to arrive in one response, which was reasonable for
 * twenty-six models and is not for two thousand — and nobody reads two
 * thousand rows anyway.
 */
function brandBlock(brand) {
  const { data } = getState();
  const open = data.openBrand === brand.id;
  const models = open ? data.brandModels : null;

  return html`
  <div class="cat-brand ${brand.isActive ? '' : 'dim'}">
    <div class="cat-h">
      <h4>
        ${brand.logo ? html`<img class="brand-logo" src="/assets/brands/${brand.logo}" alt="" loading="lazy">` : ''}
        ${brand.name} <span class="sub">${faDigits(brand._count?.models ?? 0)} مدل</span>
      </h4>
      <div class="row-actions">
        ${activeTag(brand.isActive)}
        <button class="btn sm" data-open-brand="${brand.id}">
          ${open ? 'بستن' : 'مدل‌ها'}
        </button>
        <button class="btn sm" data-edit-brand="${brand.id}" data-name="${brand.name}"
                data-order="${brand.sortOrder}" data-company="${brand.companyId || ''}">ویرایش</button>
        <button class="btn sm" data-toggle-brand="${brand.id}" data-active="${brand.isActive}">
          ${brand.isActive ? 'غیرفعال' : 'فعال'}
        </button>
      </div>
    </div>

    ${!open ? '' : !models ? html`<div class="hint" style="padding:8px 14px">در حال بارگذاری…</div>` : html`
    <table>
      <thead><tr><th>مدل</th><th>ترتیب</th><th>وضعیت</th><th></th></tr></thead>
      <tbody>
        ${models.map(
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
    </table>`}
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

  if (d.openBrand) return openBrand(d.openBrand);

  if (d.editCompany) return editModal('company', d.editCompany, d.name, d.order);
  if (d.editBrand) return editModal('brand', d.editBrand, d.name, d.order, d.company || '');
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

/**
 * Opens a brand and fetches its models, or closes it.
 *
 * One brand at a time, which is both what a person does and what keeps this to
 * one small request instead of the whole catalogue. The open brand lives in the
 * store rather than as a class on the element, because every render replaces
 * the page — read off the markup, it would snap shut on the next keystroke.
 */
async function openBrand(id) {
  const { data } = getState();

  if (data.openBrand === id) {
    setState({ data: { ...data, openBrand: null, brandModels: null } });
    return;
  }

  setState({ data: { ...data, openBrand: id, brandModels: null } });
  try {
    const { models } = await admin.brandModels(id);
    // The reader may have moved on while this was in flight; writing the models
    // of a brand they already closed would reopen it under them.
    if (getState().data.openBrand !== id) return;
    setState({ data: { ...getState().data, brandModels: models } });
  } catch (err) {
    setState({ data: { ...getState().data, openBrand: null, brandModels: null } });
    toast(err.message, 'danger');
  }
}

const UPDATERS = {
  company: admin.updateCompany,
  brand: admin.updateBrand,
  model: admin.updateModel,
  color: admin.updateColor,
};

const LABELS = { company: 'شرکت', brand: 'برند', model: 'مدل', color: 'رنگ' };

function editModal(kind, id, name, order, companyId = '') {
  const companies = getState().data.catalog?.companies || [];

  openModal({
    type: 'form',
    title: `ویرایش ${LABELS[kind]}`,
    body: html`
      <div class="field">
        <label for="c-name">نام</label>
        <input class="in" id="c-name" name="name" value="${name}" required>
      </div>

      ${
        // Only a brand has a company, and it is optional there. This is how a
        // wrong grouping gets fixed — and it will be wrong sometimes, because
        // nobody knows which company builds all 186 brands. Moving a brand
        // never changes anybody's posting permission: those are stored per
        // brand, so a correction here is only a correction.
        kind === 'brand'
          ? html`<div class="field">
              <label for="c-company">شرکت سازنده <span class="opt">(اختیاری)</span></label>
              <select class="in" id="c-company" name="companyId">
                <option value="">دسته‌بندی‌نشده</option>
                ${companies.map(
                  (c) => html`<option value="${c.id}"
                    ${raw(c.id === companyId ? 'selected' : '')}>${c.name}</option>`
                )}
              </select>
              <div class="hint">
                اگر نمی‌دانید، همان «دسته‌بندی‌نشده» بماند — برند کاملاً کار می‌کند.
              </div>
            </div>`
          : ''
      }

      <div class="field">
        <label for="c-order">ترتیب نمایش</label>
        <input class="in num" id="c-order" name="sortOrder" inputmode="numeric" value="${order}">
      </div>
      <p style="color:var(--ink-3);font-size:12px">
        تغییر نام روی آگهی‌های قبلی اثر ندارد — هر آگهی نام لحظه‌ی ثبتش را نگه داشته است.
      </p>`,
    confirmLabel: 'ثبت',
    onSubmit: async (form) => {
      const payload = {
        name: form.name.value.trim(),
        sortOrder: Number(form.sortOrder.value || 0),
      };
      if (kind === 'brand') payload.companyId = form.companyId.value;

      await UPDATERS[kind](id, payload);
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
        <label for="c-company">شرکت سازنده <span class="opt">(اختیاری)</span></label>
        <select class="in" id="c-company" name="companyId">
          <option value="">دسته‌بندی‌نشده</option>
          ${companies.map((c) => html`<option value="${c.id}">${c.name}</option>`)}
        </select>
        <div class="hint">اگر نمی‌دانید خالی بگذارید — بعداً از «ویرایش» قابل تعیین است.</div>
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
  const brands = data.catalog?.brands || [];

  openModal({
    type: 'form',
    title: 'مدل جدید',
    body: html`
      <div class="field">
        <label for="c-brand">برند</label>
        <select class="in" id="c-brand" name="brandId" required>
          ${brands.map((b) => html`<option value="${b.id}">${b.name}</option>`)}
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
