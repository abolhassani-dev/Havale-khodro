# فصل ۶ — فرانت‌اند

**در این فصل:** پنل بدون فریم‌ورک چطور کار می‌کند — بوت، مسیریابی، حالت، رندر،
کلیک، فرم‌ها، فراخوانی API — و در پایان ساختن یک صفحه‌ی جدید.

مسیر: `frontend/`. اجرا: `npm run dev` (از همین پوشه). بدون build، بدون وابستگی.

---

## ۶.۱ چرخه‌ی عمر

```
index.html ─▶ src/main.js
  boot()            session.js: GET /auth/session → user یا null؛ اگر نماینده، دسترسی اشتراک
  startRouter()     router.js: هش را می‌خواند، نگهبان‌ها را می‌گذراند، load() صفحه را صدا می‌زند
  render()          root.innerHTML = String(page())   ← هر setState() دوباره این را می‌زند
  یک شنونده‌ی click روی document برای همه‌ی دکمه‌ها
```

نگهبان‌های router به ترتیب: نشست نیست → صفحه‌ی ورود؛ `mustChangePassword` →
تغییر رمز؛ نماینده و `!user.guideSeen` → `#guide` (تا تأیید)؛ صفحه‌ی ناشناخته →
`homeFor()`.

---

## ۶.۲ حالت و رندر

`state/store.js`:

```js
getState()                // { user, access, page, params, data, loading, modal, toast, … }
setState({ data: … })     // ادغام و رندر کامل
subscribe(fn)             // main.js با آن رندر می‌کند
isAdmin(), isAgent(), can('tickets')   // can() از سرور می‌پرسد، نه از جدول محلی
```

**پیامد مهم:** رندر یعنی `innerHTML` از نو. هر چیزی که کاربر در فرم تایپ کرده، اگر
در DOM نباشد، می‌پرد. پس:

- داده‌ی صفحه (`data`) و وضعیت ناوبری در store است.
- ورودی‌های فرم، انتخابگر برند، تاریخ شمسی، `pickSelect`، نقشه‌ی بدنه — همه
  حالتشان را **در DOM** نگه می‌دارند و با `data-*` می‌خوانند.
- وقتی فقط یک تکه باید عوض شود (مثلاً پنل جزئیات قیمت)، همان تکه را با
  `el.innerHTML = String(html\`…\`)` بازنویسی کنید، نه `setState`.

---

## ۶.۳ markup: `html` و `raw`

```js
import { html, raw } from '../../ui/html.js';

html`<td>${user.agencyName}</td>`             // escape می‌شود — همیشه
html`<input ${raw(on ? 'checked' : '')}>`     // raw فقط برای رشته‌ی ثابت یا markup خودمان
html`${items.map((i) => html`<li>${i}</li>`)}` // آرایه‌ی html`` پشت هم می‌چسبد
```

قاعده‌ها:

- **هر `raw()` باید در diff قابل دفاع باشد**: صفت بولی، sentinel خالی، markup
  ثابت، یا literal با ورودی ثابت. هرگز داده‌ی سرور یا کاربر.
- `href`/`src` که از سرور می‌آید: `safeUrl(u)` (فهرست مجاز scheme).
- هیچ `onclick=`، هیچ `<script>` داخل markup، هیچ `eval`. CSP سرور
  (`script-src 'self'`) به هر حال اجرایشان نمی‌کند.
- متن سرور که باید بی‌escape نمایش داده شود؟ وجود ندارد — به جز
  `content/guide.js` که ماژول ایستای خودمان است.

---

## ۶.۴ کلیک: `data-*` و `CLICK_KEYS`

هیچ `addEventListener` روی دکمه‌ها نیست. یک شنونده روی `document` در `main.js`
نزدیک‌ترین عنصر با `data-*` ثبت‌شده را پیدا می‌کند و به تابع مربوط می‌فرستد:

```html
<button data-reveal="${h.id}">نمایش مشخصات</button>
<a data-go="guide" data-go-params="ch=car-post">راهنما</a>
```

```js
// main.js
const CLICK_KEYS = new Set(['go', 'logout', 'reveal', 'report', … , 'guideAck', 'priceWatch']);
…
if (d.reveal) return revealContact(d.reveal);
```

**کلید تازه باید در `CLICK_KEYS` ثبت شود.** کلیک روی کلیدی که ثبت نشده در سکوت هیچ
کاری نمی‌کند — این دقیقاً باگی است که اسموک‌تست برای همان ساخته شد.

`data-go="page"` + `data-go-params="k=v&…"` ناوبری استاندارد است؛ مقدارها را با
`encodeURIComponent` بسازید.

---

## ۶.۵ فراخوانی API

`api/client.js` تنها `fetch` است: `credentials: 'include'`، خطاها را به `ApiError`
تبدیل می‌کند و سه رویداد سراسری دارد: `unauthenticated` (→ ورود)، `kicked`
(→ «در جای دیگری وارد شده‌اید»)، `suspended`.

`api/index.js` همه‌ی endpointها به نام:

```js
import { havales, cars, auth } from '../../api/index.js';
await havales.list({ page: 2, brandIds: 'a,b' });
await auth.guideSeen();
```

endpoint جدید → یک خط در `index.js`. هیچ‌جای دیگری URL ننویسید.

---

## ۶.۶ فرم‌ها

| نیاز | ابزار |
|---|---|
| پول (تومان با جداکننده) | `ui/moneyInput.js` — هر قیمتی باید از آن رد شود |
| تاریخ شمسی | `ui/dateInput.js` (ماه/سال، `Intl` با `fa-IR-u-ca-persian`) |
| انتخاب از فهرست بلند با جستجو | `ui/pickSelect.js` |
| برند/مدل (تک یا چند) | `ui/brandPicker.js`, `ui/brandFilter.js` |
| چیپ‌های چندانتخابی | `ui/checkChips.js` |
| فایل | `ui/filePicker.js` |
| فیلترهای تاشو | `ui/filterBox.js` (`<details>` بومی) |
| خطای فرم زیر فیلد | `feedback.js` → `showFormError(form, err)` (۴۲۲ را روی فیلد می‌نشاند) |

**قاعده‌ی فیلدها:** هر `input/select/textarea` باید `id` یا `name` داشته باشد و
فیلدهای متنی `autocomplete` — `settleAutocomplete()` در `main.js` جای خالی را با
`off` پر می‌کند، ولی id/name را باید خودتان بدهید (DevTools بدون آن‌ها هشدار می‌دهد
و اسموک‌تست شمارش می‌کند).

ارسال: `form.addEventListener('submit')` نه — از `data-*` روی دکمه یا از مودال
(`runModalAction`) که `onSubmit(form)` می‌گیرد.

---

## ۶.۷ نمایش

- اعداد فارسی: `faDigits()`، پول: `money()`، تاریخ: `date()/dateTime()` از
  `ui/format.js`. رقم‌ها سه‌تایی جدا می‌شوند؛ قیمت‌های بزرگ در صفحه‌ی قیمت روز به
  «میلیون» گرد می‌شوند.
- بازخورد: `toast(msg, 'danger')`, `openModal({...})`, `emptyBox()`, `loadingBox()`,
  `pager()`.
- نوار بالا لینک «راهنمای این بخش» را از `PAGE_CHAPTER` در `content/guide.js`
  می‌سازد؛ صفحه‌ی جدید یک ورودی آن‌جا می‌خواهد.
- CSS در `styles/app.css` و `app-extra.css`؛ کلاس‌های عمومی: `card`, `btn`,
  `tag`, `banner`, `filters-box`. موبایل‌اول؛ نقطه‌ی شکست اصلی ۹۰۰px.

---

## ۶.۸ راهنمای عملی: صفحه‌ی جدید

مثال: صفحه‌ی «استعلام قطعات» (`parts-search`).

1. **API** — `api/index.js`: `export const parts = { list: (q) => api.get('/parts', q), … }`.
2. **صفحه** — `pages/agent/parts.js`:
   ```js
   export async function loadPartsSearch(params) { return { items: await parts.list(params) }; }
   export function partsSearchPage() { const { data } = getState(); return html`…`; }
   ```
3. **ثبت** در `main.js`: `route('parts-search', loadPartsSearch)`، عنوان در
   `TITLES`، و `case 'parts-search': return partsSearchPage();` در `render`.
4. **منو** — `ui/shell.js` → `AGENT_NAV`.
5. **کلیک‌ها** — هر `data-partsX` در `CLICK_KEYS` + شاخه‌ی مربوط.
6. **راهنما** — فصل جدید در `content/guide.js` + نگاشت در `PAGE_CHAPTER`.
7. **اسموک** — چند `step()` در `tests/smoke.mjs`: صفحه باز می‌شود، فیلد بی‌نام
   ندارد، کارت بدون reveal شماره ندارد.

---

## ۶.۹ چیزهایی که عمداً نیستند

`localStorage`/`sessionStorage`/`document.cookie` (صفر استفاده — نشست فقط کوکی
httpOnly است)، `console.log` (صفر)، CDN (فونت و همه‌چیز محلی)، service worker،
inline script/handler.
