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

export async function loadAdminCatalog(params) {
  // Two levels, driven by the URL: the grid of brands, and one brand's models
  // when `?brand=` names it. Route-driven rather than an accordion, because a
  // toggle or rename triggers a reload — and a reload keeps a URL where it
  // was, while it wipes whichever accordion happened to be open.
  const catalog = await admin.catalog();
  if (!params?.brand) return { catalog };

  const { models } = await admin.brandModels(params.brand);
  return { catalog, brandModels: models };
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
  const { params } = getState();
  return params.brand ? brandDetail(params.brand) : catalogGrid();
}

/**
 * Level one: every brand as a tile in a grid.
 *
 * The previous layout stacked 186 brands as full-width rows, each carrying its
 * own row of buttons — several screens of scrolling to reach حرف میم. A tile
 * is the shape this data actually has (a logo and a name), the grid puts ~30
 * of them in the first viewport, and everything done *to* a brand lives on its
 * own page instead of cluttering the list of them.
 */
function catalogGrid() {
  const { data } = getState();
  const brands = data.catalog?.brands || [];
  const colors = data.catalog?.colors || [];
  const query = (data.catalogQuery || '').trim();

  // 186 brands is too many to read, and the answer to "where is پژو" should be
  // typing پژو rather than scrolling. Matching the slug too means the Latin
  // name works — somebody who knows it as `peugeot` finds it.
  const shown = query
    ? brands.filter((b) => b.name.includes(query) || b.slug.includes(query.toLowerCase()))
    : brands;

  // One flat list, deliberately. There used to be company sections here, and
  // with most brands ungrouped the page read as a tidy top and a heap below —
  // a taxonomy that is mostly empty is worse than none. The company field
  // still exists in the data; the day it is worth showing, this is the one
  // place to bring it back.
  //
  // And the list lives inside a fixed-height panel that scrolls by itself,
  // مودال برند باما-style: the page stays one screen tall however many brands
  // the market has, and the search box never scrolls out from over the list
  // it filters.
  return html`
  <div class="card">
    <div class="card-h">
      <h2>کاتالوگ خودرو ${qtip('برندها و مدل‌هایی که نمایندگی‌ها موقع ثبت حواله از بینشان انتخاب می‌کنند. روی هر برند بزنید تا مدل‌هایش را ببینید و ویرایش کنید. مدل استفاده‌شده حذف نمی‌شود؛ غیرفعالش کنید تا از فرم ثبت بیفتد و آگهی‌های قبلی سالم بمانند.')}</h2>
      <div style="display:flex;gap:8px">
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

    ${
      shown.length
        ? html`<div class="cat-panel"><div class="cat-grid">${shown.map(brandTile)}</div></div>`
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

/** One brand in the grid. The whole tile is the way in; actions live inside. */
function brandTile(brand) {
  return html`
  <button class="cat-tile ${brand.isActive ? '' : 'dim'}" data-go="adm-catalog"
          data-go-params="brand=${brand.id}">
    ${
      brand.logo
        ? html`<img src="/assets/brands/${brand.logo}" alt="" loading="lazy">`
        : html`<span class="cat-tile-blank">${brand.name.slice(0, 1)}</span>`
    }
    <span class="cat-tile-name">${brand.name}</span>
    <span class="sub num">${faDigits(brand._count?.models ?? 0)} مدل</span>
    ${brand.isActive ? '' : html`<span class="tag">بازنشسته</span>`}
  </button>`;
}

/**
 * Level two: one brand, its models, and everything done to either.
 *
 * A page rather than an accordion or a modal, so the URL survives the reload
 * that follows every edit — rename a model and you are still looking at the
 * brand you were working on, with the browser's back button as the way out.
 */
function brandDetail(brandId) {
  const { data } = getState();
  const brand = (data.catalog?.brands || []).find((b) => b.id === brandId);
  const models = data.brandModels || [];

  if (!brand) return emptyBox('برند پیدا نشد.');

  const retired = models.filter((m) => !m.isActive).length;

  return html`
  <div class="card">
    <div class="cat-head">
      <button class="btn sm" data-go="adm-catalog">→ همه‌ی برندها</button>
      ${
        brand.logo
          ? html`<img class="cat-head-logo" src="/assets/brands/${brand.logo}" alt="">`
          : ''
      }
      <div>
        <h2>${brand.name}</h2>
        <div class="sub">
          <span class="num">${brand.slug}</span>
          ${brand.companyId ? ` · ${companyName(brand.companyId)}` : ''}
          · ${faDigits(models.length)} مدل${retired ? ` (${faDigits(retired)} بازنشسته)` : ''}
        </div>
      </div>
      <span class="spacer"></span>
      ${activeTag(brand.isActive)}
      <button class="btn sm" data-edit-brand="${brand.id}" data-name="${brand.name}"
              data-order="${brand.sortOrder}" data-company="${brand.companyId || ''}">ویرایش</button>
      <button class="btn sm" data-toggle-brand="${brand.id}" data-active="${brand.isActive}">
        ${brand.isActive ? 'غیرفعال' : 'فعال'}
      </button>
      <button class="btn primary sm" data-new-model>مدل جدید</button>
    </div>

    ${
      models.length
        ? html`<table>
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
                    <button class="btn sm" data-toggle-model="${model.id}"
                            data-active="${model.isActive}" data-name="${model.name}">
                      ${model.isActive ? 'غیرفعال' : 'فعال'}
                    </button>
                  </td>
                </tr>`
              )}
            </tbody>
          </table>`
        : emptyBox('این برند هنوز مدلی ندارد.')
    }
  </div>`;
}

function companyName(id) {
  return (getState().data.catalog?.companies || []).find((c) => c.id === id)?.name || '';
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
  openModal({
    type: 'form',
    title: 'برند جدید',
    body: html`
      ${nameField()}
      ${slugField()}`,
    confirmLabel: 'بساز',
    onSubmit: async (form) => {
      await admin.createBrand({
        name: form.name.value.trim(),
        slug: form.slug.value.trim(),
      });
      toast('برند اضافه شد');
      await resolve();
    },
  });
}

function newModelModal() {
  const { data, params } = getState();
  const brands = data.catalog?.brands || [];
  // On a brand's own page, that brand is the answer — asking again would be
  // the screen forgetting where it is.
  const current = params.brand || '';

  openModal({
    type: 'form',
    title: 'مدل جدید',
    body: html`
      <div class="field">
        <label for="c-brand">برند</label>
        <select class="in" id="c-brand" name="brandId" required>
          ${brands.map(
            (b) => html`<option value="${b.id}" ${raw(b.id === current ? 'selected' : '')}>
              ${b.name}
            </option>`
          )}
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
