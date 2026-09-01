/**
 * Browser smoke test.
 *
 * Every unit of this frontend could pass in isolation and the product still be
 * broken — a click handler that matches nothing fails in perfect silence, and
 * that is exactly the bug this caught first. So this drives a real browser
 * against a real API and asserts what a user would see.
 *
 * The step that matters most is the masking check: it walks the document and
 * fails if a phone number appears anywhere outside a card this agent actually
 * revealed. If that goes red, treat it as an incident.
 *
 * Run:
 *   node tests/dev-server.js &                 # static files + /api proxy
 *   cd ../backend && npm run dev &
 *   AGENT_USER=... AGENT_PASS=... ADMIN_USER=... ADMIN_PASS=... node tests/smoke.mjs
 *
 * OWNER_USER / OWNER_PASS are optional and unlock the owner's own screen. They
 * are optional because that account is made on the server by hand and has no
 * fixed name — which is the point of it.
 */
import { chromium } from 'playwright';

const errors = [];
const BASE = process.env.BASE_URL || 'http://localhost:5173/';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  // A signed-out visitor probing /auth/me gets 401 by design — that is the
  // session check working, not a defect. Anything else stays a failure.
  if (/status of 401/.test(m.text())) return;
  // Likewise 422: the suite deliberately submits a listing whose paid amount
  // exceeds its total, to prove the form survives being refused. The API
  // refusing it is the behaviour under test. An unexpected 422 anywhere else
  // still fails, because the step that caused it would not get what it waits
  // for.
  if (/status of 422/.test(m.text())) return;
  // And 403/404: the intrusion step below really attacks this server — a SQL
  // payload, a request for /wp-login.php — and being refused is the behaviour
  // under test. An unexpected one anywhere else still fails, because the step
  // that caused it would not get what it waits for.
  if (/status of (403|404)/.test(m.text())) return;
  errors.push(m.text());
});
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

async function step(name, fn) {
  try { await fn(); console.log('✓', name); }
  catch (e) { console.log('✕', name, '→', e.message.split('\n')[0]); process.exitCode = 1; }
}

/**
 * Navigate to a page in the agent sidebar.
 *
 * The menu is grouped into collapsible sections, so a link can be in the
 * document and not clickable. Clicking it directly worked until the sections
 * arrived and then timed out with "element is not visible", which reads like a
 * missing link rather than a closed drawer. This opens the section first when
 * it needs to — and in doing so, exercises the drawer on every run.
 */
async function navigate(pageName) {
  const link = page.locator(`.nav [data-go="${pageName}"]`);
  if (!(await link.isVisible())) {
    const section = page.locator(`.navsec:has([data-go="${pageName}"]) .sechead`);
    await section.click();
    await link.waitFor({ state: 'visible', timeout: 3000 });
  }
  await link.click();
}

await page.goto(BASE, { waitUntil: 'networkidle' });

await step('login page renders', async () => {
  await page.waitForSelector('form[data-form="login"]', { timeout: 5000 });
});

await step('agent can sign in', async () => {
  await page.fill('#username', process.env.AGENT_USER || 'freshtest');
  await page.fill('#password', process.env.AGENT_PASS || 'Demo@12345');
  await page.click('button[type=submit]');
  await page.waitForSelector('.sidebar', { timeout: 8000 });
});

await step('dashboard shows real figures', async () => {
  await page.waitForSelector('.stats .s-v', { timeout: 5000 });
  const t = await page.textContent('.stats');
  if (!/[۰-۹]/.test(t)) throw new Error('no Persian numerals: ' + t.slice(0, 60));
});


/**
 * A listing this agent has certainly not revealed.
 *
 * The masking checks below are the most important in the suite, and they can
 * only prove something if the market holds at least one listing belonging to
 * somebody else that this viewer has not already opened. On a dev database
 * that stops being true after a few runs — a reveal is permanent, so yesterday's
 * runs quietly turn every card into a revealed one and the assertion passes
 * vacuously on nothing.
 *
 * So the run posts one itself, from a second agency, and takes it away at the
 * end. Give AGENT2_USER / AGENT2_PASS to enable it; without them the masking
 * steps still run, but against whatever the database happens to hold.
 */
async function postAsSecondAgency() {
  const user = process.env.AGENT2_USER;
  const pass = process.env.AGENT2_PASS;
  if (!user || !pass) return null;

  const context = await browser.newContext();
  const other = await context.newPage();
  await other.goto(BASE, { waitUntil: 'networkidle' });
  await other.fill('input[name="username"]', user);
  await other.fill('input[name="password"]', pass);
  await other.click('button[type="submit"]');
  await other.waitForSelector('.nav', { timeout: 15000 });

  // Posted through the API rather than the form: this is scaffolding for the
  // masking checks, not the form's own test — that one is further down and
  // drives every field by hand.
  const id = await other.evaluate(async () => {
    const tree = await fetch('/api/v1/catalog', { credentials: 'include' }).then((r) => r.json());
    const brand = (tree.data?.brands || []).find((b) => b.canPost || b.postableModelIds?.length);
    if (!brand) return null;

    const models = await fetch(`/api/v1/catalog/brands/${brand.id}/models`, { credentials: 'include' })
      .then((r) => r.json());
    const allowed = brand.canPost
      ? models.data?.models || []
      : (models.data?.models || []).filter((m) => (brand.postableModelIds || []).includes(m.id));
    if (!allowed.length) return null;

    const res = await fetch('/api/v1/havales', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'OFFER',
        carModelId: allowed[0].id,
        solh: 'SOLH',
        carColor: tree.data?.colors?.[0]?.name,
        model: '1405',
        carPriceToman: 1_200_000_000,
        amountToman: 950_000_000,
        paidAmountToman: 300_000_000,
        paymentType: 'CASH',
        deliveryDays: 45,
        depositDays: 7,
        description: 'آگهی زمینه برای تست ماسک — در پایان اجرا برداشته می‌شود',
      }),
    });
    const body = await res.json();
    return body?.data?.id || null;
  });

  await context.close();
  return id ? { id, user, pass } : null;
}

/** Takes that listing away again, so the next run starts from the same place. */
async function removeSecondAgencyListing(posted) {
  if (!posted) return;
  const context = await browser.newContext();
  const other = await context.newPage();
  await other.goto(BASE, { waitUntil: 'networkidle' });
  await other.fill('input[name="username"]', posted.user);
  await other.fill('input[name="password"]', posted.pass);
  await other.click('button[type="submit"]');
  await other.waitForSelector('.nav', { timeout: 15000 });
  await other.evaluate(
    (id) => fetch(`/api/v1/havales/${id}`, { method: 'DELETE', credentials: 'include' }),
    posted.id
  );
  await context.close();
}

let backdrop = null;

await step('a second agency has something on the market', async () => {
  backdrop = await postAsSecondAgency();
  if (!backdrop && (process.env.AGENT2_USER || process.env.AGENT2_PASS)) {
    throw new Error('the second agency could not post — check its brands');
  }
});

await step('search lists havales with contact hidden', async () => {
  await navigate('search');
  await page.waitForSelector('.hcard', { timeout: 8000 });
  const hidden = await page.locator('.contact.hidden').count();
  if (hidden === 0) throw new Error('expected at least one masked listing');
});

/**
 * The test that matters most.
 *
 * Every phone number in the document must sit inside a card this agent has
 * actually revealed. A number anywhere else means the server sent something it
 * should not have, and the daily cap and the audit log are both bypassed.
 */
await step('no unrevealed phone number anywhere in the document', async () => {
  const stray = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('.hcard').forEach((card) => {
      const phones = card.textContent.match(/09\d{9}/g);
      if (phones && !card.querySelector('.contact.shown') && !card.classList.contains('own')) {
        out.push(phones.join(','));
      }
    });
    return out;
  });
  if (stray.length) throw new Error('leaked outside a revealed card: ' + stray.join(' | '));

  const hiddenCards = await page.locator('.contact.hidden').count();
  if (hiddenCards === 0) throw new Error('nothing was masked — the test proved nothing');
});

await step('reveal asks before spending the allowance', async () => {
  await page.click('.contact.hidden button[data-reveal]');
  await page.waitForSelector('.modal', { timeout: 5000 });
  const t = await page.textContent('.modal-b');
  if (!t.includes('سقف روزانه')) throw new Error('confirmation does not mention the cap');
});

await step('confirming reveals the number', async () => {
  await page.click('.modal-f [data-confirm]');
  await page.waitForSelector('.contact.shown', { timeout: 8000 });
  const phone = await page.textContent('.contact.shown .phone');
  if (!/\d{11}/.test(phone.replace(/\D/g, '') ? phone : '')) throw new Error('no phone shown: ' + phone);
});

await step('my listings page loads', async () => {
  await navigate('mine');
  await page.waitForSelector('table, .empty', { timeout: 8000 });
});

await step('new listing form populates models from the catalogue', async () => {
  await navigate('new-offer');
  await page.waitForSelector('#brand', { timeout: 8000 });
  await page.selectOption('#brand', { index: 1 });
  await page.waitForFunction(() => document.querySelector('#carModelId').options.length > 1, null, { timeout: 5000 });
});

/**
 * Actually submitting the form, which nothing used to do.
 *
 * The backend suite builds its payload as an object and posts it, so it never
 * exercised the browser's serialisation — and the browser was sending the
 * model year as a number against a schema that types it as text. Every sale
 * listing posted from this form was refused, and no test anywhere noticed,
 * because no test anywhere pressed the button.
 *
 * Persian numerals on purpose: that is what an Iranian keyboard produces.
 */
// Kept so the run can take it away again — see the cleanup step below.
let postedId = null;

await step('a listing can actually be posted from the form', async () => {
  await navigate('new-offer');
  await page.waitForSelector('#brand', { timeout: 8000 });
  await page.selectOption('#brand', { index: 1 });
  await page.waitForFunction(() => document.querySelector('#carModelId').options.length > 1, null, { timeout: 5000 });
  await page.selectOption('#carModelId', { index: 1 });
  await page.selectOption('#carColor', { index: 1 });
  await page.fill('#model', '۱۴۰۴');
  await page.fill('#carPriceToman-in', '۱۲۰۰۰۰۰۰۰۰');
  await page.fill('#amountToman-in', '۹۵۰۰۰۰۰۰۰');
  await page.fill('#paidAmountToman-in', '۳۰۰۰۰۰۰۰۰');
  // An enum, not a number. Sent through the digit conversion the money fields
  // use, `Number(enDigits('CASH'))` is NaN and every sale listing is refused —
  // which is what this step exists to notice.
  await page.selectOption('#paymentType', 'STAGED');
  await page.fill('#deliveryDays', '۴۵');
  await page.fill('#depositDays', '۷');
  await page.fill('#description', 'ثبت آزمایشی از تست دودی');
  await page.click('form[data-form="havale"] button[type=submit]');
  await page.waitForFunction(() => location.hash.includes('mine'), null, { timeout: 8000 });
  await page.waitForSelector('table tbody tr', { timeout: 8000 });
  postedId = await page.getAttribute('table tbody tr [data-open-havale]', 'data-open-havale');
});

// The three money figures are different things — the car, the transfer
// document, and what has been paid so far — and a listing that shows one of
// them under another's label is worse than one that shows none.
await step('the listing carries the car price and the payment terms back', async () => {
  await page.click('table tbody tr [data-open-havale]');
  await page.waitForSelector('.modal-b', { timeout: 5000 });
  const t = (await page.textContent('.modal-b')).replace(/\s+/g, ' ');
  for (const label of ['قیمت خودرو', 'مبلغ حواله', 'مبلغ واریز شده', 'نحوه پرداخت']) {
    if (!t.includes(label)) throw new Error(`«${label}» is missing from the listing`);
  }
  if (!t.includes('چند مرحله‌ای')) throw new Error('the payment terms did not come back: ' + t.slice(0, 200));
  await page.click('[data-close-modal]');
});

// A refused submit must leave the form and its contents alone. Routing this
// through the store re-rendered the page and emptied every field, so the user
// was told what was wrong and lost their work in the same instant.
await step('a refused submit keeps what was typed', async () => {
  await navigate('new-offer');
  await page.waitForSelector('#brand', { timeout: 8000 });
  await page.selectOption('#brand', { index: 1 });
  await page.waitForFunction(() => document.querySelector('#carModelId').options.length > 1, null, { timeout: 5000 });
  await page.selectOption('#carModelId', { index: 1 });
  await page.selectOption('#carColor', { index: 1 });
  await page.fill('#model', '۱۴۰۴');
  await page.fill('#carPriceToman-in', '۲۰۰۰۰۰۰');
  await page.fill('#amountToman-in', '۱۰۰۰۰۰۰');
  await page.fill('#paidAmountToman-in', '۹۹۹۹۹۹۹۹۹');   // more than the total
  await page.selectOption('#paymentType', 'CASH');
  await page.fill('#deliveryDays', '۳۰');
  await page.fill('#depositDays', '۷');
  await page.fill('#description', 'این متن نباید گم شود');
  await page.click('form[data-form="havale"] button[type=submit]');
  await page.waitForSelector('.errslot .banner', { timeout: 8000 });

  const kept = await page.inputValue('#description');
  if (kept !== 'این متن نباید گم شود') throw new Error('the form was wiped: ' + JSON.stringify(kept));

  const message = (await page.textContent('.errslot')).trim();
  if (/failed custom validation|Validation failed/.test(message)) {
    throw new Error('untranslated validator output reached the user: ' + message);
  }
});

/**
 * A price groups itself as it is typed, and still posts as bare digits.
 *
 * Both halves matter and only one of them is visible. The field the person
 * reads carries «۲٬۰۰۰٬۰۰۰»; the field the form submits has to carry
 * «2000000», because the API takes a number. The first time this was built the
 * two collided over one name and every price was posted empty — with the
 * server answering that a filled-in field was required.
 */
await step('a price is grouped on screen and bare in the payload', async () => {
  await page.fill('#carPriceToman-in', '۲۰۰۰۰۰۰');

  const shown = await page.inputValue('#carPriceToman-in');
  if (shown !== '۲٬۰۰۰٬۰۰۰') throw new Error('the price was not grouped: ' + shown);

  const sent = await page.evaluate(() => {
    const form = document.querySelector('form[data-form="havale"]');
    return String(form.carPriceToman.value);
  });
  if (sent !== '2000000') throw new Error('the form would post «' + sent + '»');
});

/**
 * The deadline on a ثبت‌نامی advertisement is chosen in the Iranian calendar.
 *
 * Worth a browser step rather than a unit test, because the failure this
 * guards against is invisible in the markup: the control is Jalali on screen
 * and Gregorian in the field the form submits, and only a real browser can say
 * whether those two agree. The check is a round trip — pick a Jalali day, read
 * what the form would send, and format it back with the same calendar the rest
 * of the interface uses.
 */
await step('the ثبت‌نامی deadline is picked in the Iranian calendar', async () => {
  await navigate('reg-offer');
  await page.waitForSelector('[data-jdt]', { timeout: 8000 });

  if (await page.locator('input[type="date"]').count()) {
    throw new Error('a Gregorian date input is still on the form');
  }

  const months = await page.locator('[data-jdt-part="month"] option').allInnerTexts();
  if (!months.includes('شهریور')) throw new Error('the months are not Iranian months');

  await page.selectOption('[data-jdt-part="year"]', { index: 1 });
  await page.selectOption('[data-jdt-part="month"]', '5');
  await page.selectOption('[data-jdt-part="day"]', '31');

  const value = await page.locator('[data-jdt] input[type="hidden"]').inputValue();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('the form is not carrying a Gregorian date: ' + JSON.stringify(value));
  }
  const shown = await page.evaluate(
    (iso) => new Intl.DateTimeFormat('fa-IR-u-ca-persian', { month: 'long', day: 'numeric' })
      .format(new Date(`${iso}T12:00:00`)),
    value
  );
  if (!shown.includes('مرداد') || !shown.includes('۳۱')) {
    throw new Error(`۳۱ مرداد was submitted as ${value}, which reads back as ${shown}`);
  }

  // مهر has thirty days. Offering a day the month does not have is a form that
  // argues with the person filling it in.
  await page.selectOption('[data-jdt-part="month"]', '7');
  if (await page.locator('[data-jdt-part="day"]').inputValue() !== '30') {
    throw new Error('۳۱ مهر survived the month change');
  }
});

/**
 * The خودرو market, end to end.
 *
 * The body map is the one component in the product where the form's chips and
 * the display's dots must agree part for part — so the same run marks two
 * parts, posts the advertisement, and then checks the dots came out on the
 * map with the derived grade beside them.
 */
let smokeCarId = null;

await step('a car is posted with its body marked', async () => {
  await navigate('car-sell');
  await page.waitForSelector('form[data-form="car"]', { timeout: 8000 });

  await page.selectOption('form[data-form="car"] select[name="brand"]', { index: 1 });
  await page.waitForFunction(() => {
    const f = document.querySelector('form[data-form="car"]');
    return f && !f.carModelId.disabled && f.carModelId.options.length > 1;
  }, null, { timeout: 8000 });
  await page.selectOption('form[data-form="car"] select[name="carModelId"]', { index: 1 });

  // The body shape came off the catalogue, not off a seller choice.
  const shown = await page.inputValue('[data-body-type-show]');
  if (!shown || shown.includes('تعیین می‌شود')) {
    throw new Error('choosing a model did not show its body type: ' + shown);
  }

  await page.fill('#year', '1402');
  await page.fill('#mileageKm', '38000');
  await page.selectOption('#carColor', { index: 1 });
  await page.selectOption('#warranty', 'true');
  await page.fill('#carPriceToman-in', '1140000000');

  // «دارد» with nothing marked must be refused before the server is asked.
  await page.click('[data-body-marked]');
  await page.click('form[data-form="car"] button[type=submit]');
  await page.waitForTimeout(400);
  const refusal = await page.locator('form[data-form="car"] .banner.danger').count();
  if (!refusal) throw new Error('an empty «دارد» table was not refused');

  await page.click('.bm-chip[data-body-chip="fnd-f-d"][data-st="PARTIAL"]');
  await page.click('.bm-chip[data-body-chip="hood"][data-st="PAINT"]');
  const grade = (await page.textContent('[data-body-grade]')).trim();
  if (grade !== 'رنگ‌شده') throw new Error('the live grade is wrong: ' + grade);
  // The map redraws under the seller's hand: two chips, two dots, on the
  // shape the chosen model has.
  const liveDots = await page.locator('[data-body-live] .bm-dot').count();
  if (liveDots !== 2) throw new Error(`the live map shows ${liveDots} dots for two marked parts`);

  await page.fill('#description', 'آگهی اسموک خودرو — در پایان اجرا برداشته می‌شود');
  await page.click('form[data-form="car"] button[type=submit]');
  await page.waitForSelector('table', { timeout: 8000 });

  smokeCarId = await page.evaluate(async () => {
    const res = await fetch('/api/v1/cars/mine?status=ACTIVE', { credentials: 'include' })
      .then((r) => r.json());
    return (res.data?.items || []).find((c) => c.isOwn && c.bodyGrade === 'PAINTED')?.id || null;
  });
  if (!smokeCarId) throw new Error('the posted car is not in «خودروهای من»');
});

await step('the map shows the marked parts as dots, grade and all', async () => {
  await navigate('car-search');
  await page.waitForSelector('.hcard, .empty', { timeout: 8000 });

  await page.click(`[data-open-car="${smokeCarId}"]`);
  await page.waitForSelector('.modal .bm-map', { timeout: 8000 });
  const dots = await page.locator('.modal .bm-dot').count();
  if (dots !== 2) throw new Error(`2 parts were marked, the map shows ${dots} dots`);
  const modalText = await page.textContent('.modal');
  if (!modalText.includes('رنگ‌شده')) throw new Error('the derived grade is not on the dialogue');
  if (!modalText.includes('گلگیر جلو راننده')) {
    throw new Error('the marked part is not spelled out under the map');
  }
  await page.click('[data-close-modal]');
});

await step('the run removes the car it posted', async () => {
  if (!smokeCarId) throw new Error('nothing was captured to clean up');
  const status = await page.evaluate(
    (id) => fetch(`/api/v1/cars/${id}`, { method: 'DELETE', credentials: 'include' })
      .then((r) => r.status),
    smokeCarId
  );
  if (status !== 200) throw new Error('delete answered ' + status);
});

await step('subscription page loads with a real invoice', async () => {
  await navigate('subscription');
  // Waits for the data, not just the frame: the previous version read the DOM
  // while the page was still loading and blamed the page.
  await page.waitForFunction(
    () => document.querySelector('.content')?.textContent.includes('صورتحساب'),
    null, { timeout: 8000 }
  );
  const t = await page.textContent('.content');
  if (!t.includes('تومان')) throw new Error('invoice has no amounts');
});

await step('tickets page loads', async () => {
  await navigate('tickets');
  await page.waitForSelector('.card', { timeout: 8000 });
});

await step('account settings page loads', async () => {
  await navigate('profile');
  await page.waitForSelector('form[data-form="profile-password"]', { timeout: 8000 });
  const t = await page.textContent('.content');
  if (!t.includes('کد نمایندگی')) throw new Error('profile does not show the agency code');
});

/**
 * Typed text is behind the reveal, not behind a filter.
 *
 * The rule this replaced was a filter over free text, and it was beaten three
 * times in one afternoon — a number written «۰۰۹۸…», a box nobody had thought
 * to guard, a model-year field that took twenty characters. Not serving the box
 * ends that argument instead of winning it: there is nothing to encode into.
 *
 * Worth a browser step because it is a *product* promise as much as a security
 * one — the card must still be worth reading with the typing taken out of it.
 */
await step('a card carries no typed text until the contact is opened', async () => {
  await navigate('reg-search');
  await page.waitForSelector('.hcard, .empty', { timeout: 8000 });

  const locked = page.locator('.hcard:has(.desc.locked)').first();
  if (!(await locked.count())) return; // nothing unrevealed on this database

  const text = (await locked.innerText()).replace(/\s+/g, ' ');
  if (!/با «نمایش مشخصات» باز می‌شوند/.test(text)) {
    throw new Error('the card does not say what is behind the reveal');
  }
  // And it must not have become a card with nothing on it: the structured
  // facts — what the market is actually searched by — all stay.
  for (const label of ['نوع فروش', 'قیمت خودرو', 'مبلغ امتیاز']) {
    if (!text.includes(label)) throw new Error(`«${label}» left the card too`);
  }
});

/**
 * A listing can be corrected, and the correction is not silent.
 *
 * The two halves have to be checked together, because either alone is a bad
 * feature: an edit nobody can make leaves stale prices on the market, and an
 * edit nobody can see is how a listing read by three hundred agencies quietly
 * becomes a different offer. What must never be on the form is the car itself.
 */
await step('a listing can be edited, and says that it was', async () => {
  await navigate('mine');
  await page.waitForSelector('table tbody tr', { timeout: 8000 });

  const edit = page.locator('[data-edit-havale]').first();
  if (!(await edit.count())) throw new Error('no editable listing on «حواله‌های من»');
  await edit.click();
  await page.waitForSelector('.modal-b', { timeout: 8000 });

  const form = (await page.textContent('.modal-b')).replace(/\s+/g, ' ');
  if (!form.includes('خودرو و نوع آگهی قابل تغییر نیستند')) {
    throw new Error('the form does not say what cannot be changed');
  }
  if (await page.locator('.modal-b #brand, .modal-b [name="carModelId"]').count()) {
    throw new Error('the edit form offers to change the car');
  }

  await page.fill('#amountToman-in', '۸۸۸۰۰۰۰۰۰');
  await page.click('.modal button[type=submit]');
  await page.waitForTimeout(1500);

  const table = (await page.textContent('table')).replace(/\s+/g, ' ');
  if (!table.includes('ویرایش‌شده')) throw new Error('the edited listing is not marked');
});

/**
 * The notice box opens, and marks itself read.
 *
 * Whether it has anything in it depends on the database this runs against, so
 * the step checks the two things that are true either way: the page renders,
 * and opening it clears the unread badge. The content itself — which listing,
 * which reason, which strike number — is covered by the backend suite.
 */
await step('the notice box opens and marks itself read', async () => {
  await navigate('notices');
  await page.waitForSelector('.ntc-list, .empty', { timeout: 8000 });

  await navigate('dash');
  // Long enough for the badge window to be re-asked after the seen write.
  await page.waitForTimeout(1200);
  const badge = await page.locator('.sidebar a:has-text("اطلاعیه‌ها") .nav-badge').count();
  if (badge) throw new Error('the badge survived reading the box');
});

// A menu item that goes nowhere reads as broken, so these must render real
// copy rather than an empty frame — and must not silently bounce home, which
// is what an unregistered route would do.
await step('a not-yet-built section explains itself instead of dead-ending', async () => {
  // قطعات is the placeholder now that the خودرو market went live.
  await navigate('parts-search');
  await page.waitForSelector('.soon-card', { timeout: 8000 });
  const t = await page.textContent('.soon-card');
  if (t.trim().length < 80) throw new Error('placeholder has no explanation: ' + t.trim());
  if (!t.includes('به‌زودی')) throw new Error('placeholder does not say it is coming');
});

/**
 * The run takes back what it posted.
 *
 * Without this, every smoke run left one more listing owned by the test agency
 * at the top of the market — and after enough runs the first page of the search
 * was entirely its own, so «nothing was masked» and four steps went red for a
 * reason that had nothing to do with the code. A test that degrades the thing
 * it measures stops measuring it.
 *
 * A soft delete, which is what the button in the panel does: the row stays for
 * the audit trail and leaves the market.
 */
await step('the run removes the background listing too', async () => {
  await removeSecondAgencyListing(backdrop);
});

await step('the run removes the listing it posted', async () => {
  if (!postedId) throw new Error('nothing was captured to clean up');

  const status = await page.evaluate(async (id) => {
    const res = await fetch(`/api/v1/havales/${id}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    return res.status;
  }, postedId);

  if (status !== 200) throw new Error(`cleanup answered ${status}`);
});

await step('logout returns to sign-in', async () => {
  await page.click('[data-logout]');
  await page.waitForSelector('form[data-form="login"]', { timeout: 8000 });
});

await step('admin can sign in and see monitoring', async () => {
  await page.fill('#username', process.env.ADMIN_USER);
  await page.fill('#password', process.env.ADMIN_PASS);
  await page.click('button[type=submit]');
  await page.waitForSelector('.sidebar', { timeout: 8000 });
  await page.click('[data-go="adm-monitor"]');
  await page.waitForSelector('.tl-row, .empty', { timeout: 8000 });
});

/**
 * Every button in the kartabl actually goes somewhere.
 *
 * The dashboard's «اشتراک رو به پایان» row linked to the agencies list with
 * `status=EXPIRING` — and «EXPIRING» is not an account status, so the server
 * refused it and the first thing an admin saw after pressing «رسیدگی» was a
 * red validation banner. A link written in one file against a validator in
 * another cannot be checked by either of them; it can only be checked by
 * pressing it.
 */
await step('every kartabl button opens without an error', async () => {
  await page.goto(`${BASE}#adm-dash`);
  await page.waitForSelector('.kartabl', { timeout: 8000 });

  const rows = await page.locator('.kt-row').count();
  for (let i = 0; i < rows; i += 1) {
    await page.goto(`${BASE}#adm-dash`);
    await page.waitForSelector('.kt-row', { timeout: 8000 });
    const label = (await page.locator('.kt-row .kt-t b').nth(i).innerText()).trim();

    await page.locator('.kt-row button').nth(i).click();
    await page.waitForTimeout(1200);

    // The failure banner specifically, not the word «خطا» anywhere on the page:
    // a support ticket can be *about* an error and say so in its subject.
    if (await page.locator('.content > .banner.danger').count()) {
      const why = (await page.textContent('.content > .banner.danger')).replace(/\s+/g, ' ');
      throw new Error(`«${label}» landed on an error — ${why.trim()}`);
    }
  }

  // Put the page back where the next step expects to find it: this one walks
  // away from the monitoring screen that the previous step opened.
  await page.goto(`${BASE}#adm-monitor`);
  await page.waitForSelector('.tl-row, .empty', { timeout: 8000 });
});

await step('timeline entry explains itself in a sentence', async () => {
  await page.click('[data-activity]');
  await page.waitForSelector('.modal', { timeout: 5000 });
  const t = await page.textContent('.modal-b');
  if (t.trim().length < 20) throw new Error('description too short: ' + t);
  console.log('   →', t.trim().split('\n')[0].slice(0, 100));
});

await page.click('[data-close-modal]');

/**
 * Page two actually being page two.
 *
 * The pager is one shared component and every list in the panel draws it, so a
 * mistake in it is a mistake everywhere at once — and the way it fails is
 * silent: buttons that render, click, and leave the same rows on screen. The
 * timeline is where it can be pressed for real, because the log is the one list
 * that always has more rows than a page in any database old enough to test on.
 */
await step('the pager moves to the next page', async () => {
  await page.goto(`${BASE}#adm-monitor`);
  await page.waitForSelector('.tl-row, .empty', { timeout: 8000 });
  if (!(await page.locator('.pager .pg').count())) return; // a fresh database, nothing to page
  const first = await page.locator('.tl-row').first().innerText();

  await page.locator('.pager .pg', { hasText: 'بعدی' }).click();
  await page.waitForTimeout(1200);
  await page.waitForSelector('.tl-row', { timeout: 8000 });

  if (await page.locator('.content > .banner.danger').count()) {
    throw new Error('page two landed on an error banner');
  }
  const current = await page.locator('.pager .pg.on').innerText();
  if (!/۲/.test(current)) throw new Error(`pager did not advance — still on ${current}`);
  if ((await page.locator('.tl-row').first().innerText()) === first) {
    throw new Error('page two shows the same rows as page one');
  }
});

/**
 * The log as something you can search.
 *
 * The failure this guards against is the quiet one: a filter that stops
 * filtering. A search bar that returns the same rows whatever is in it looks
 * like it works, and every answer it gives is wrong.
 */
await step('the log can be searched, not only scrolled', async () => {
  await page.waitForSelector('form[data-form="activity-filters"]', { timeout: 5000 });

  const families = await page.locator('#family option').count();
  if (families < 5) throw new Error(`only ${families} event groups reached the filter`);

  await page.selectOption('#family', 'AUTH');
  await page.click('form[data-form="activity-filters"] button[type=submit]');
  await page.waitForFunction(() => !document.querySelector('.content.is-busy'), null, { timeout: 8000 });
  await page.waitForTimeout(300);

  const text = await page.textContent('.tl');
  if (/حواله ثبت کرد|آگهی ثبت‌نامی ثبت کرد/.test(text)) {
    throw new Error('a listing event survived the «ورود و خروج» filter');
  }
  if (!/وارد سامانه|خارج شد/.test(text)) {
    throw new Error('the sign-ins did not survive their own filter');
  }

  // A serial nobody has used must return nothing, not everything — the version
  // of this bug where an unmatched filter is dropped rather than applied.
  await page.goto(`${BASE}#adm-monitor?serial=99999999`);
  await page.waitForFunction(() => !document.querySelector('.content.is-busy'), null, { timeout: 8000 });
  await page.waitForTimeout(300);
  if (await page.locator('.tl-row').count()) {
    throw new Error('an unmatched serial returned rows');
  }

  await page.goto(`${BASE}#adm-monitor`);
  await page.waitForSelector('.tl-row', { timeout: 8000 });
});

/**
 * One moderation screen per market.
 *
 * The desk shares its code across markets, so the mistake to catch is the
 * cheap one: a filter that silently stops filtering and puts every market's
 * rows on both screens. Asserted through the menu and the table, because that
 * is where somebody would notice it — or fail to.
 */
await step('each market has its own moderation screen', async () => {
  // Waited on by title rather than by table: both screens draw the same
  // table, so a wait on `tr` is satisfied by the page already on screen and
  // the assertion then reads the wrong one.
  await page.click('[data-go="adm-havales"]');
  await page.waitForSelector('.card-h h2:has-text("حواله‌ها")', { timeout: 8000 });
  const havales = await page.textContent('.content');
  if (!havales.includes('کل حواله‌ها')) throw new Error('the حواله desk lost its header');

  await page.click('[data-go="adm-registrations"]');
  await page.waitForSelector('.card-h h2:has-text("آگهی‌های ثبت‌نامی")', { timeout: 8000 });
  const registrations = await page.textContent('.content');
  if (!registrations.includes('آگهی‌های ثبت‌نامی')) {
    throw new Error('the ثبت‌نامی desk did not open');
  }
  // Nothing from the other market's vocabulary on this screen.
  if (/حواله فروش|واگذاری/.test(registrations)) {
    throw new Error('a حواله row is showing on the ثبت‌نامی desk');
  }

  // The third desk came from one config entry, which is exactly how it could
  // be forgotten: the menu line, the page title and the table are the three
  // places that entry has to reach.
  await page.click('[data-go="adm-cars"]');
  await page.waitForSelector('.card-h h2:has-text("آگهی‌های خودرو")', { timeout: 8000 });
  const cars = await page.textContent('.content');
  if (!cars.includes('قیمت خودرو')) throw new Error('the خودرو desk lost its price column');
  if (/حواله فروش|واگذاری|ظرفیت ثبت‌نام/.test(cars)) {
    throw new Error('another market\'s row is showing on the خودرو desk');
  }
});

await step('catalogue editor shows the brand grid', async () => {
  await page.click('[data-go="adm-catalog"]');
  await page.waitForSelector('.cat-grid .cat-tile', { timeout: 8000 });
  // A tile opens the brand's own page, models and all — the drill-in is the
  // whole design, so the smoke walks it once.
  await page.locator('.cat-tile').first().click();
  await page.waitForSelector('.cat-head', { timeout: 8000 });
  await page.click('.cat-head [data-go="adm-catalog"]');
  await page.waitForSelector('.cat-grid', { timeout: 8000 });
});

// An ordinary administrator must not learn that the owner account exists. The
// menu is the one place it would show, so this asserts on the menu rather than
// on the route: the route is refused by the server either way, but a greyed-out
// «کاربران سیستم» would answer the question all by itself.
await step('an ordinary admin sees no trace of the owner', async () => {
  const nav = await page.textContent('.nav');
  if (nav.includes('کاربران سیستم')) throw new Error('the staff screen is in the menu');
  if (nav.includes('مالک')) throw new Error('the owner heading is in the menu');
});

// A heading with nothing under it advertises a part of the system the reader
// cannot reach — and «مالک» would advertise the account this design exists to
// keep quiet. Checked for every account the suite signs in as, because
// per-account ticks make an empty group the ordinary case rather than the odd
// one.
await step('no menu heading stands over an empty section', async () => {
  const empty = await page.evaluate(() =>
    [...document.querySelectorAll('.nav .group')]
      .filter((g) => !g.nextElementSibling || g.nextElementSibling.classList.contains('group'))
      .map((g) => g.textContent.trim())
  );
  if (empty.length) throw new Error('headings over nothing: ' + empty.join(', '));
});

/**
 * The owner's screen.
 *
 * Skipped unless an owner account is supplied, because there is exactly one and
 * it was made on the server by hand — the whole point being that it cannot be
 * created from inside the product. Run it with:
 *
 *   OWNER_USER=... OWNER_PASS=... node tests/smoke.mjs
 */
if (process.env.OWNER_USER) {
  await step('owner signs in and reaches the staff screen', async () => {
    await page.click('[data-logout]');
    await page.waitForSelector('form[data-form="login"]', { timeout: 8000 });
    await page.fill('#username', process.env.OWNER_USER);
    await page.fill('#password', process.env.OWNER_PASS);
    await page.click('button[type=submit]');
    await page.waitForSelector('.sidebar', { timeout: 8000 });
    await page.click('.nav [data-go="adm-staff"]');
    await page.waitForSelector('table', { timeout: 8000 });
  });

  await step('the permission boxes come from the server, not from this file', async () => {
    await page.click('[data-new-staff]');
    await page.waitForSelector('.modal [data-staff-form]', { timeout: 5000 });
    const boxes = await page.locator('.modal input[name^="perm:"]').count();
    if (!boxes) throw new Error('no permission checkboxes rendered');

    // The owner-only permissions are not offered: they cannot be delegated, and
    // a box that always refuses to save is worse than no box.
    const owner = await page.locator('.modal input[name="perm:staff"]').count();
    if (owner) throw new Error('an owner-only permission is offered for delegation');
  });

  // OWNER is deliberately absent from the list the server sends. A screen that
  // could mint a second owner is a screen worth attacking.
  await step('the owner role cannot be handed out', async () => {
    const roles = await page.locator('.modal #role option').allTextContents();
    if (roles.some((r) => r.trim() === 'مالک')) throw new Error('OWNER is offered as a role');
  });

  // The role is a starting point, not the answer — the reason this screen exists
  // at all. If the dropdown stops re-ticking, the label and the boxes disagree
  // and the label is what everybody remembers. It failed exactly this way once:
  // the handler recognised the form by a `data-form` name no modal ever carries.
  await step('choosing a role re-ticks its defaults', async () => {
    await page.selectOption('.modal #role', 'FINANCE');
    await page.waitForTimeout(150);
    const finance = await page.locator('.modal input[name^="perm:"]:checked').count();
    await page.selectOption('.modal #role', 'SUPER_ADMIN');
    await page.waitForTimeout(150);
    const superAdmin = await page.locator('.modal input[name^="perm:"]:checked').count();
    if (!finance) throw new Error('FINANCE ticked nothing at all');
    if (finance === superAdmin) throw new Error('the role dropdown changed nothing');
  });

  await step('«همه» and «هیچ‌کدام» tick one group and no other', async () => {
    const key = await page.locator('.modal [data-perm-all]').first().getAttribute('data-perm-all');
    const others = () =>
      page.locator(`.modal .perm:not([data-group="${key}"]) input:checked`).count();

    await page.selectOption('.modal #role', 'SUPER_ADMIN');
    await page.waitForTimeout(150);
    const before = await others();

    await page.click(`.modal [data-perm-none="${key}"]`);
    if (await page.locator(`.modal .perm[data-group="${key}"] input:checked`).count()) {
      throw new Error('«هیچ‌کدام» left boxes ticked');
    }
    if ((await others()) !== before) throw new Error('«هیچ‌کدام» reached into another group');

    await page.click(`.modal [data-perm-all="${key}"]`);
    const all = await page.locator(`.modal .perm[data-group="${key}"] input`).count();
    const on = await page.locator(`.modal .perm[data-group="${key}"] input:checked`).count();
    if (on !== all) throw new Error(`«همه» ticked ${on} of ${all}`);
  });

  await page.click('.modal [data-close-modal]');

  // The row for the owner's own account offers no buttons. Suspending yourself
  // out of the only account that can un-suspend you should not be one click
  // away, and the server refuses it too.
  await step('the owner account cannot be changed from the screen', async () => {
    const owner = page.locator('tbody tr', { hasText: process.env.OWNER_USER });
    if (await owner.locator('[data-staff-status]').count()) {
      throw new Error('the owner row offers a suspend button');
    }
    if (await owner.locator('[data-edit-staff]').count()) {
      throw new Error('the owner row offers an edit button');
    }
  });

  /**
   * The technical log.
   *
   * The assertion that matters is the negative one, and it was checked with a
   * super admin further up: this screen is behind a permission the permissions
   * table gives to the owner alone. Here we only prove it is reachable and
   * renders — a page nobody can open is the same as a page that does not exist.
   */
  await step('the owner reaches the technical log', async () => {
    await navigate('adm-errors');
    await page.waitForSelector('.card-h h2:has-text("لاگ فنی")', { timeout: 8000 });

    const tabs = await page.locator('.card-h .tab').allInnerTexts();
    if (!tabs.some((t) => t.includes('کند'))) {
      throw new Error('no tab for slow requests: ' + tabs.join('، '));
    }

    // Either it lists something or it says why it is empty. What it must never
    // do is render a blank card, which reads as broken.
    await page.goto(`${BASE}#adm-errors?tab=slow`);
    await page.waitForFunction(() => !document.querySelector('.content.is-busy'), null, { timeout: 8000 });
    await page.waitForTimeout(300);
    const body = await page.textContent('.content');
    if (!(await page.locator('.elog-row').count()) && !body.includes('کندتر نبوده')) {
      throw new Error('the slow tab rendered nothing and said nothing');
    }
  });

  /**
   * The intrusion log.
   *
   * Driven by really attacking the server from inside the browser, because a
   * detector asserted against a fixture proves the fixture. The payloads below
   * cannot succeed — parameterised queries, escaped output — and that is the
   * point: what is being checked is that trying leaves a record somebody can
   * read.
   */
  await step('an attempted intrusion reaches the owner’s screen', async () => {
    await page.evaluate(async () => {
      await fetch("/api/v1/havales?carType=' OR 1=1 --", { credentials: 'include' });
      await fetch('/api/v1/havales', {
        credentials: 'include',
        headers: { 'User-Agent': 'x' },
      });
    });
    // A scanner announcing itself — the clearest signal there is.
    await page.evaluate(() => fetch('/api/v1/../wp-login.php', { credentials: 'include' }));

    await navigate('adm-security');
    await page.waitForSelector('.card-h h2:has-text("لاگ امنیتی")', { timeout: 8000 });
    // The record is written after the response is on the wire, so a moment
    // passes between the attack and the row.
    await page.waitForSelector('[data-sec-event]', { timeout: 8000 });

    const text = await page.textContent('.content');
    if (!/تزریق SQL|اسکن مسیرهای شناخته‌شده/.test(text)) {
      throw new Error('the attempt was not named: ' + text.slice(0, 120));
    }
    if (!text.includes('آی‌پی خود شما')) {
      throw new Error('the reader is not shown their own address beside the block button');
    }

    await page.locator('[data-sec-event]').first().click();
    await page.waitForSelector('.modal', { timeout: 5000 });
    const modal = await page.textContent('.modal');
    if (!modal.includes('چه چیزی فرستاده شده')) {
      throw new Error('the entry does not show what was sent');
    }
    await page.click('[data-close-modal]');
  });
}

/**
 * The phone drawer.
 *
 * Its own viewport, because none of the above would have caught any of this:
 * the button that opens the menu is underneath the menu once it is open, so
 * there has to be a way out from inside — and the open state has to survive a
 * re-render, or expanding a section inside the drawer makes the drawer vanish.
 */
const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
phone.on('pageerror', (e) => errors.push('pageerror (phone): ' + e.message));

const drawerOpen = () => phone.locator('#sb').evaluate((el) => el.classList.contains('show'));
const openDrawer = async () => { await phone.click('.menubtn'); await phone.waitForTimeout(350); };
const scrollsSideways = () =>
  phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);

await step('phone: signs in', async () => {
  await phone.goto(process.env.BASE_URL || 'http://localhost:5173/', { waitUntil: 'networkidle' });
  await phone.fill('#username', process.env.AGENT_USER || 'alborz');
  await phone.fill('#password', process.env.AGENT_PASS || 'Demo@12345');
  await phone.click('button[type=submit]');
  await phone.waitForSelector('.topbar', { timeout: 8000 });
});

// The closed drawer used to sit at `inset-inline-start: -100%`, which still
// counts toward the page's scrollable width — so every phone page scrolled
// sideways by exactly one screen.
await step('phone: no page scrolls sideways', async () => {
  if (await scrollsSideways()) throw new Error('the page is wider than the screen');
});

await step('phone: the drawer can be closed three ways', async () => {
  await openDrawer();
  if (!(await drawerOpen())) throw new Error('the menu button did not open it');

  await phone.click('.sb-close');
  await phone.waitForTimeout(350);
  if (await drawerOpen()) throw new Error('the ✕ inside did not close it');

  await openDrawer();
  await phone.locator('.sb-backdrop').click({ position: { x: 40, y: 500 } });
  await phone.waitForTimeout(350);
  if (await drawerOpen()) throw new Error('tapping the page behind did not close it');

  await openDrawer();
  await phone.keyboard.press('Escape');
  await phone.waitForTimeout(350);
  if (await drawerOpen()) throw new Error('Escape did not close it');
});

await step('phone: the drawer survives expanding a section', async () => {
  await openDrawer();
  await phone.click('[data-nav-section="car"]');
  await phone.waitForTimeout(350);
  if (!(await drawerOpen())) throw new Error('expanding a section closed the whole menu');

  await phone.click('.nav [data-go="car-search"]');
  await phone.waitForTimeout(700);
  if (await drawerOpen()) throw new Error('following a link left the menu covering the page');
  // The خودرو market is live now — the search screen, not a placeholder.
  await phone.waitForSelector('.kind-tabs, .grid, .empty', { timeout: 8000 });
  if (await scrollsSideways()) throw new Error('the page scrolls sideways');
});

await step('phone: menu items take a pointer, not a text caret', async () => {
  const cursor = await phone
    .locator('.nav [data-go="search"]')
    .evaluate((el) => getComputedStyle(el).cursor);
  if (cursor !== 'pointer') throw new Error(`cursor is "${cursor}"`);
});

if (errors.length) { console.log('\nconsole errors:'); errors.slice(0, 10).forEach((e) => console.log('  ', e)); process.exitCode = 1; }
else console.log('\nno console errors');

await browser.close();
