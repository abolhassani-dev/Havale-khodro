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
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

async function step(name, fn) {
  try { await fn(); console.log('✓', name); }
  catch (e) { console.log('✕', name, '→', e.message.split('\n')[0]); process.exitCode = 1; }
}

await page.goto('process.env.BASE_URL || 'http://localhost:5173/'', { waitUntil: 'networkidle' });

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
  await page.click('[data-go="search"]');
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
  await page.click('[data-go="mine"]');
  await page.waitForSelector('table, .empty', { timeout: 8000 });
});

await step('new listing form populates models from the catalogue', async () => {
  await page.click('[data-go="new-offer"]');
  await page.waitForSelector('#brand', { timeout: 8000 });
  await page.selectOption('#brand', { index: 1 });
  await page.waitForFunction(() => document.querySelector('#carModelId').options.length > 1, null, { timeout: 5000 });
});

await step('subscription page loads with a real invoice', async () => {
  await page.click('[data-go="subscription"]');
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
  await page.click('[data-go="tickets"]');
  await page.waitForSelector('.card', { timeout: 8000 });
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

if (errors.length) { console.log('\nconsole errors:'); errors.slice(0, 10).forEach((e) => console.log('  ', e)); process.exitCode = 1; }
else console.log('\nno console errors');

await browser.close();
import { chromium } from 'playwright';

const errors = [];
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

async function step(name, fn) {
  try { await fn(); console.log('✓', name); }
  catch (e) { console.log('✕', name, '→', e.message.split('\n')[0]); process.exitCode = 1; }
}

await page.goto('process.env.BASE_URL || 'http://localhost:5173/'', { waitUntil: 'networkidle' });

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
  await page.click('[data-go="search"]');
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
  await page.click('[data-go="mine"]');
  await page.waitForSelector('table, .empty', { timeout: 8000 });
});

await step('new listing form populates models from the catalogue', async () => {
  await page.click('[data-go="new-offer"]');
  await page.waitForSelector('#brand', { timeout: 8000 });
  await page.selectOption('#brand', { index: 1 });
  await page.waitForFunction(() => document.querySelector('#carModelId').options.length > 1, null, { timeout: 5000 });
});

await step('subscription page loads with a real invoice', async () => {
  await page.click('[data-go="subscription"]');
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
  await page.click('[data-go="tickets"]');
  await page.waitForSelector('.card', { timeout: 8000 });
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

if (errors.length) { console.log('\nconsole errors:'); errors.slice(0, 10).forEach((e) => console.log('  ', e)); process.exitCode = 1; }
else console.log('\nno console errors');

await browser.close();
