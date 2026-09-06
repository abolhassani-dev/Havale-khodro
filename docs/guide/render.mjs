// The agency guide as a PDF, built from the same chapters the panel shows.
//
//   node docs/guide/render.mjs
//
// One source: frontend/src/content/guide.js. Edit the chapters there and both
// the «راهنما» page and this PDF change together. Chromium does the rendering
// so Persian shaping, RTL and page breaks come out right.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from '../../frontend/node_modules/playwright/index.mjs';
import { CHAPTERS } from '../../frontend/src/content/guide.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DIR, '../..');
const fa = (n) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);

const intro = CHAPTERS.find((c) => c.num === 0);
const numbered = CHAPTERS.filter((c) => c.num > 0);

const page = `<!doctype html>
<html lang="fa" dir="rtl"><head><meta charset="utf-8">
<title>راهنمای سامانه فرانوکار</title>
<style>${fs.readFileSync(path.join(DIR, 'print.css'), 'utf8')}</style>
</head><body>
<section class="cover">
  <div>
    <div class="brand">فرانوکار</div>
    <div class="sub">راهنمای استفاده از سامانه — ویژه‌ی نمایندگی‌ها</div>
  </div>
  <div class="box">
    <p>این دفترچه هر بخش سامانه را با تصویر واقعی، به زبان ساده، توضیح می‌دهد: چه چیزی است، چطور استفاده می‌شود، و قانونش چیست.</p>
    <p>هر فصل مستقل است؛ لازم نیست از اول بخوانید. مستقیم بروید سراغ بخشی که با آن کار دارید. همین راهنما داخل خود سامانه، در منوی «راهنما»، همیشه در دسترس است.</p>
  </div>
  <div class="meta">بخش «قطعات» هنوز فعال نشده و در این نسخه نیامده است.</div>
</section>
<section class="chapter">
  <h2>فهرست</h2>
  <div class="toc">${numbered.map((c) => `<div><span><span class="n">${fa(c.num)}</span>${c.title}</span></div>`).join('')}</div>
  <h3>${intro.title}</h3>
  ${intro.body}
</section>
${numbered
  .map(
    (c) => `<section class="chapter">
  <span class="kicker">فصل ${fa(c.num)}</span>
  <h2>${c.title}</h2>
  ${c.body.replaceAll('src="/assets/guide/', 'src="../../frontend/assets/guide/')}
</section>`
  )
  .join('\n')}
</body></html>`;

const tmp = path.join(DIR, '.guide.tmp.html');
fs.writeFileSync(tmp, page);

const font = fs.readFileSync(path.join(ROOT, 'frontend/assets/vazirmatn.woff2')).toString('base64');
const footer = `
  <style>@font-face{font-family:'V';src:url(data:font/woff2;base64,${font}) format('woff2');}</style>
  <div style="font-family:'V',sans-serif;font-size:9px;color:#6b7a76;width:100%;padding:0 14mm;display:flex;justify-content:space-between;direction:rtl">
    <span>راهنمای سامانه فرانوکار</span>
    <span>صفحه <span class="pageNumber"></span> از <span class="totalPages"></span></span>
  </div>`;

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium' });
const tab = await browser.newPage();
await tab.goto(`file://${tmp}`, { waitUntil: 'networkidle' });
await tab.evaluate(() => document.fonts.ready);
await tab.waitForTimeout(400);
await tab.pdf({
  path: path.join(DIR, 'راهنمای-فرانوکار.pdf'),
  format: 'A4',
  printBackground: true,
  preferCSSPageSize: true,
  displayHeaderFooter: true,
  headerTemplate: '<span></span>',
  footerTemplate: footer,
  margin: { top: '16mm', right: '14mm', bottom: '18mm', left: '14mm' },
});
await browser.close();
fs.unlinkSync(tmp);
console.log('pdf written:', path.join(DIR, 'راهنمای-فرانوکار.pdf'));
