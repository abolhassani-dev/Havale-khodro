import { html } from '../../ui/html.js';
import { icon } from '../../ui/icons.js';
import { getState } from '../../state/store.js';
import { SOON_PAGES } from '../../ui/shell.js';

/**
 * The screens for markets that are in the menu but not yet built.
 *
 * A menu entry that goes nowhere is worse than no menu entry: the reader
 * assumes it is broken, and the next thing they assume is that the rest might
 * be too. So each of these says what the section will do, in the words of the
 * business rather than a generic "coming soon", and points at the part of the
 * product that works today.
 *
 * They are static by design — no route loader, no request. Nothing here can
 * fail, so nothing here needs an error state.
 */

const COPY = {
  car: {
    title: 'خرید و فروش خودرو',
    lead: 'این بخش برای معامله‌ی خودِ خودرو است، نه حواله‌ی آن.',
    body:
      'به‌زودی می‌توانید خودروی موجود خود را — صفر یا کارکرده — برای فروش آگهی کنید، ' +
      'و درخواست خرید ثبت کنید تا نمایندگی‌های دیگر با شما تماس بگیرند. ' +
      'همان قواعد آشنای حواله اینجا هم برقرار است: مشخصات تماس تا وقتی طرف مقابل ' +
      '«نمایش مشخصات» نزند مخفی می‌ماند و سقف روزانه‌ی شما رعایت می‌شود.',
  },
  reg: {
    title: 'ثبت‌نامی خودرو',
    lead: 'برای وقتی که نمایندگی آن برند را ندارید، ولی مشتری دارید.',
    body:
      'فرض کنید مشتری لاماری می‌خواهد و شما نمایندگی لاماری ندارید. در این بخش ' +
      'درخواست ثبت‌نام می‌زنید و هر نمایندگی‌ای که ظرفیت ثبت‌نام آن برند را دارد ' +
      'می‌تواند پاسخ دهد — و برعکس، اگر ظرفیت ثبت‌نامی دارید می‌توانید اعلامش کنید ' +
      'تا دیگران پیدایتان کنند. این با حواله فرق دارد: آنجا خودرو ثبت‌نام‌شده است ' +
      'و حواله‌اش جابه‌جا می‌شود، اینجا هنوز ثبت‌نامی در کار نیست.',
  },
  parts: {
    title: 'قطعات خودرو',
    lead: 'بازار قطعات، در همین سامانه.',
    body:
      'در فازهای بعدی، عرضه و تقاضای قطعات هم به سامانه اضافه می‌شود: قطعه‌ای که ' +
      'موجود دارید را آگهی کنید، یا قطعه‌ای که لازم دارید را درخواست بزنید و ' +
      'بگذارید تأمین‌کننده‌ها سراغتان بیایند.',
  },
};

export function soonPage() {
  const { page } = getState();
  const entry = SOON_PAGES.get(page);
  if (!entry) return html`<div class="card"><div class="pad">این صفحه هنوز آماده نیست.</div></div>`;

  const { section, child } = entry;
  const copy = COPY[section.id] || { title: section.label, lead: '', body: '' };

  return html`
  <div class="card soon-card">
    <div class="soon-top">
      <span class="soon-ico">${icon(section.icon, 26)}</span>
      <div>
        <h2>${copy.title}</h2>
        <p class="soon-lead">${copy.lead}</p>
      </div>
      <span class="tag w">به‌زودی</span>
    </div>

    <div class="soon-body">
      <p>${copy.body}</p>

      <div class="soon-here">
        <b>صفحه‌ای که باز کردید:</b> ${child.label}
      </div>

      <p class="soon-note">
        این بخش هنوز فعال نشده است. تا آن روز، بخش <b>حواله</b> کامل در دسترس شماست.
      </p>
    </div>

    <div class="soon-foot">
      <button class="btn primary" data-go="search">رفتن به استعلام حواله‌ها</button>
      <button class="btn" data-go="dash">داشبورد</button>
    </div>
  </div>`;
}
