// Render the guide to PDF with Chromium (proper Persian shaping and RTL).
import { chromium } from '/home/user/Havale-khodro/frontend/node_modules/playwright/index.mjs';
import fs from 'fs';

const DIR = '/home/user/Havale-khodro/docs/guide';
const font = fs.readFileSync('/home/user/Havale-khodro/frontend/assets/vazirmatn.woff2').toString('base64');

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage();
await page.goto(`file://${DIR}/index.html`, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(500);

const footer = `
  <style>@font-face{font-family:'V';src:url(data:font/woff2;base64,${font}) format('woff2');}</style>
  <div style="font-family:'V',sans-serif;font-size:9px;color:#6b7a76;width:100%;padding:0 14mm;display:flex;justify-content:space-between;direction:rtl">
    <span>راهنمای سامانه فرانوکار</span>
    <span>صفحه <span class="pageNumber"></span> از <span class="totalPages"></span></span>
  </div>`;

await page.pdf({
  path: `${DIR}/راهنمای-فرانوکار.pdf`,
  format: 'A4',
  printBackground: true,
  preferCSSPageSize: true,
  displayHeaderFooter: true,
  headerTemplate: '<span></span>',
  footerTemplate: footer,
  margin: { top: '16mm', right: '14mm', bottom: '18mm', left: '14mm' },
});
await browser.close();
console.log('pdf written');
