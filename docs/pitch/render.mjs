import { chromium } from '/home/user/Havale-khodro/frontend/node_modules/playwright/index.mjs';
const DIR = '/home/user/Havale-khodro/docs/pitch';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage();
await page.goto(`file://${DIR}/index.html`, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(400);
await page.pdf({
  path: `${DIR}/معرفی-فرانوکار.pdf`,
  width: '338.67mm', height: '190.5mm',
  printBackground: true, preferCSSPageSize: true, margin: { top: 0, right: 0, bottom: 0, left: 0 },
});
await browser.close();
console.log('pdf written');
