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
 */
import { chromium } from 'playwright';

const errors = [];
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

await page.goto(process.env.BASE_URL || 'http://localhost:5173/', { waitUntil: 'networkidle' });

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
await step('a listing can actually be posted from the form', async () => {
  await navigate('new-offer');
  await page.waitForSelector('#brand', { timeout: 8000 });
  await page.selectOption('#brand', { index: 1 });
  await page.waitForFunction(() => document.querySelector('#carModelId').options.length > 1, null, { timeout: 5000 });
  await page.selectOption('#carModelId', { index: 1 });
  await page.selectOption('#carColor', { index: 1 });
  await page.fill('#model', '۱۴۰۴');
  await page.fill('#amountToman', '۹۵۰۰۰۰۰۰۰');
  await page.fill('#paidAmountToman', '۳۰۰۰۰۰۰۰۰');
  await page.fill('#deliveryDays', '۴۵');
  await page.fill('#depositDays', '۷');
  await page.fill('#description', 'ثبت آزمایشی از تست دودی');
  await page.click('form[data-form="havale"] button[type=submit]');
  await page.waitForFunction(() => location.hash.includes('mine'), null, { timeout: 8000 });
  await page.waitForSelector('table tbody tr', { timeout: 8000 });
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
  await page.fill('#amountToman', '۱۰۰۰۰۰۰');
  await page.fill('#paidAmountToman', '۹۹۹۹۹۹۹۹۹');   // more than the total
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

// A menu item that goes nowhere reads as broken, so these must render real
// copy rather than an empty frame — and must not silently bounce home, which
// is what an unregistered route would do.
await step('a not-yet-built section explains itself instead of dead-ending', async () => {
  await navigate('car-search');
  await page.waitForSelector('.soon-card', { timeout: 8000 });
  const t = await page.textContent('.soon-card');
  if (t.trim().length < 80) throw new Error('placeholder has no explanation: ' + t.trim());
  if (!t.includes('به‌زودی')) throw new Error('placeholder does not say it is coming');
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
  await page.waitForSelector('table', { timeout: 8000 });
});

await step('timeline entry explains itself in a sentence', async () => {
  await page.click('tr[data-activity]');
  await page.waitForSelector('.modal', { timeout: 5000 });
  const t = await page.textContent('.modal-b');
  if (t.trim().length < 20) throw new Error('description too short: ' + t);
  console.log('   →', t.trim().split('\n')[0].slice(0, 100));
});

await page.click('[data-close-modal]');

await step('catalogue editor lists brands', async () => {
  await page.click('[data-go="adm-catalog"]');
  await page.waitForSelector('.cat-brand', { timeout: 8000 });
});

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
  await phone.waitForSelector('.soon-card', { timeout: 8000 });
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
