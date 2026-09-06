// Screenshots of every agency-facing section, for the user guide.
import { chromium } from '/home/user/Havale-khodro/frontend/node_modules/playwright/index.mjs';
import fs from 'fs';

const BASE = 'http://127.0.0.1:5173/';
const OUT = '/tmp/claude-0/-home-user-Havale-khodro/71c781a2-85a9-5823-bb83-f67e86e415b7/scratchpad/shots';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, locale: 'fa-IR' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

const settle = async (ms = 700) => {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(ms);
};
const shot = async (name, opts = {}) => {
  await settle();
  await page.screenshot({ path: `${OUT}/${name}.png`, ...opts });
  console.log('📷', name);
};
const go = async (route) => {
  await page.click(`[data-go="${route}"]`);
  await settle();
};
const tryStep = async (name, fn) => {
  try { await fn(); } catch (e) { console.log('  ✗', name, '—', e.message.split('\n')[0]); }
};
const login = async (u, p) => {
  await page.goto(BASE);
  await settle();
  await page.fill('#username', u);
  await page.fill('#password', p);
  await page.click('button[type=submit]');
  await page.waitForSelector('.sidebar', { timeout: 10000 });
  await settle();
};
const logout = async () => {
  await page.click('[data-logout]').catch(() => {});
  await settle();
};

// Sign-in page
await page.goto(BASE);
await settle();
await page.fill('#username', 'zagros');
await shot('login');

await login('zagros', 'Demo@12345');
await shot('dash');

await tryStep('notices', async () => { await go('notices'); await shot('notices'); });

await tryStep('car-prices', async () => {
  await go('car-prices');
  await shot('car-prices');
  const star = page.locator('[data-price-watch]').first();
  await star.click();
  await settle();
  await shot('car-prices-star');
  await page.locator('[data-price-pick]').first().click();
  await settle();
  await shot('car-prices-pick');
});

// حواله
await tryStep('search', async () => {
  await go('search');
  await shot('search');
  await page.click('.filters-box > summary');
  await settle(400);
  await shot('search-filters');
  await page.click('.filters-box > summary');
  await settle(300);
  const reveal = page.locator('.contact.hidden button[data-reveal]').first();
  if (await reveal.count()) {
    await reveal.scrollIntoViewIfNeeded();
    await reveal.click();
    await settle(400);
    await shot('search-reveal-ask');
    await page.click('.modal [data-confirm]');
    await settle();
    await shot('search-revealed');
  }
});
await tryStep('new-offer', async () => { await go('new-offer'); await shot('new-offer', { fullPage: true }); });
await tryStep('new-request', async () => { await go('new-request'); await shot('new-request', { fullPage: true }); });
await tryStep('mine', async () => {
  await go('mine');
  await shot('mine');
  await page.click('table tbody tr [data-open-havale]');
  await settle();
  await shot('mine-detail');
  await page.click('[data-close-modal]');
  await settle(300);
});

// خودرو
await tryStep('car-search', async () => {
  await go('car-search');
  await shot('car-search');
  await page.click('.filters-box > summary');
  await settle(400);
  await shot('car-search-filters');
  await page.click('.filters-box > summary');
  await settle(300);
  const open = page.locator('[data-open-car]').first();
  await open.scrollIntoViewIfNeeded();
  await open.click();
  await settle();
  await shot('car-detail');
  await page.click('[data-close-modal]');
  await settle(300);
});
await tryStep('car-sell', async () => {
  await go('car-sell');
  await shot('car-sell', { fullPage: true });
  await page.click('.bm-group:has(.bm-chip[data-body-chip="hood"]) > summary');
  await settle(300);
  await page.click('.bm-chip[data-body-chip="hood"][data-st="PAINT"]');
  await settle(300);
  await page.click('.bm-group:has(.bm-chip[data-body-chip="fnd-f-d"]) > summary');
  await settle(300);
  await page.click('.bm-chip[data-body-chip="fnd-f-d"][data-st="PARTIAL"]');
  await settle(400);
  const map = page.locator('.body-map, [data-body-map], .bm').first();
  if (await map.count()) await map.scrollIntoViewIfNeeded();
  await shot('car-sell-body', { fullPage: true });
});
await tryStep('car-buy', async () => { await go('car-buy'); await shot('car-buy', { fullPage: true }); });
await tryStep('car-mine', async () => { await go('car-mine'); await shot('car-mine'); });

// ثبت‌نامی
await tryStep('reg-search', async () => { await go('reg-search'); await shot('reg-search'); });
await tryStep('reg-offer', async () => { await go('reg-offer'); await shot('reg-offer', { fullPage: true }); });
await tryStep('reg-request', async () => { await go('reg-request'); await shot('reg-request', { fullPage: true }); });
await tryStep('reg-mine', async () => { await go('reg-mine'); await shot('reg-mine'); });

// حساب
await tryStep('profile', async () => { await go('profile'); await shot('profile', { fullPage: true }); });
await tryStep('subscription', async () => { await go('subscription'); await shot('subscription'); });
await tryStep('tickets', async () => {
  await go('tickets');
  await shot('tickets');
  await page.click('[data-new-ticket]');
  await settle(400);
  await shot('tickets-new');
});

await logout();

// زیرنمایندگی‌ها — only a reseller has the menu entry
await login('alborz', 'Demo@12345');
await tryStep('sub-agents', async () => { await go('sub-agents'); await shot('sub-agents'); });
await logout();

// Phone: the drawer
await page.setViewportSize({ width: 390, height: 780 });
await login('zagros', 'Demo@12345');
await shot('phone-dash');
await page.click('[data-toggle-sidebar]');
await settle(400);
await shot('phone-menu');
await page.click('.sb-close');
await settle(300);
await go('search');
await shot('phone-search');

await browser.close();
console.log(errors.length ? `page errors: ${errors.join(' | ')}` : 'no page errors');
