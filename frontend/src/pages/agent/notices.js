import { html } from '../../ui/html.js';
import { notices } from '../../api/index.js';
import { getState } from '../../state/store.js';
import { faDigits, dateTime, REPORT_REASON_LABEL } from '../../ui/format.js';
import { emptyBox, qtip } from '../../ui/feedback.js';
import { invalidateBadges } from '../../router.js';

/**
 * The agency's message box.
 *
 * Everything moderation does happens out of sight: a listing stops appearing,
 * a counter goes up, and one day the account will not let them in. There is an
 * SMS on a strike, but an SMS cannot be re-read next week when somebody asks
 * what actually happened. This page is the written record — what was decided,
 * on which advertisement, on what grounds, and what to do if they disagree.
 *
 * The wording lives here rather than on the server for the same reason every
 * other label does: the server sends the facts of the decision, the panel says
 * them in Persian, and the numbers inside the sentence are formatted by the
 * same helpers as the numbers everywhere else.
 */

export async function loadNotices() {
  const box = await notices.list();
  // Marked read as it is opened — the badge is about «is there something I have
  // not seen», and the answer stops being yes the moment they are looking at it.
  // Fire and forget: a failed write must not stop the page from rendering, and
  // the worst case is that the badge stays up for one more visit.
  notices
    .seen()
    .then(invalidateBadges)
    .catch(() => {});
  return { notices: box };
}

/** The heading, the colour, and whether an appeal makes sense. */
const SHAPE = {
  STRIKE: { tone: 'danger', icon: '⚑', appeal: true },
  ACCOUNT_SUSPENDED: { tone: 'danger', icon: '✕', appeal: true },
  REPORT_ABUSIVE: { tone: 'danger', icon: '⚑', appeal: true },
  REPORT_UPHELD: { tone: 'ok', icon: '✓', appeal: false },
  REPORT_REJECTED: { tone: 'warn', icon: '•', appeal: false },
};

function title(n) {
  const car = n.listing?.carType || 'آگهی';
  const serial = n.listing?.serial ? ` #${faDigits(n.listing.serial)}` : '';

  switch (n.kind) {
    case 'STRIKE':
      return `آگهی${serial} — ${car} تعلیق شد و یک اخطار برای شما ثبت شد`;
    case 'ACCOUNT_SUSPENDED':
      return 'حساب شما تعلیق شد';
    case 'REPORT_UPHELD':
      return `گزارش شما درباره‌ی آگهی${serial} تأیید شد`;
    case 'REPORT_REJECTED':
      return `گزارش شما درباره‌ی آگهی${serial} تأیید نشد`;
    case 'REPORT_ABUSIVE':
      return `گزارش شما درباره‌ی آگهی${serial} بی‌مورد تشخیص داده شد`;
    default:
      return 'اطلاعیه';
  }
}

function body(n) {
  const reason = REPORT_REASON_LABEL[n.reason] || n.reason;

  switch (n.kind) {
    case 'STRIKE':
      return html`گزارشی با عنوان «${reason}» درباره‌ی این آگهی بررسی و تأیید شد.
        این اخطار شماره‌ی ${faDigits(n.strikeNumber)} از ${faDigits(n.strikeLimit)} است؛
        با رسیدن به ${faDigits(n.strikeLimit)} اخطار، حساب تعلیق می‌شود.`;
    case 'ACCOUNT_SUSPENDED':
      return html`با ثبت ${faDigits(n.strikeNumber)} اخطار تأییدشده، حساب شما تعلیق شد.
        تا رفع تعلیق، ثبت آگهی و نمایش مشخصات برای شما بسته است — آگهی‌ها و
        سابقه‌ی شما سر جایشان هستند.`;
    case 'REPORT_UPHELD':
      return html`گزارشی که با عنوان «${reason}» ثبت کرده بودید تأیید شد و آن آگهی
        از بازار برداشته شد.`;
    case 'REPORT_REJECTED':
      return html`گزارشی که با عنوان «${reason}» ثبت کرده بودید بررسی شد، ولی تخلفی
        احراز نشد. این برای حساب شما پیامدی ندارد.`;
    case 'REPORT_ABUSIVE':
      return html`گزارشی که با عنوان «${reason}» ثبت کرده بودید بی‌مورد تشخیص داده شد و
        یک اخطار گزارش نادرست برای حساب شما ثبت شد. گزارش نادرست پیاپی، امکان
        گزارش دادن را محدود می‌کند.`;
    default:
      return '';
  }
}

/** What the appeal ticket is about, so support does not have to ask. */
function appealSubject(n) {
  if (n.kind === 'ACCOUNT_SUSPENDED') return 'اعتراض به تعلیق حساب';
  if (n.kind === 'REPORT_ABUSIVE') return `اعتراض به اخطار گزارش نادرست #${faDigits(n.reportSerial)}`;
  const serial = n.listing?.serial ? ` #${faDigits(n.listing.serial)}` : '';
  return `اعتراض به اخطار آگهی${serial}`;
}

function card(n) {
  const shape = SHAPE[n.kind] || { tone: 'warn', icon: '•', appeal: false };
  return html`
  <article class="ntc ${shape.tone}">
    <span class="ntc-ico">${shape.icon}</span>
    <div class="ntc-b">
      <div class="ntc-h">
        <b>${title(n)}</b>
        <span class="ntc-at">${dateTime(n.at)}</span>
      </div>
      <p>${body(n)}</p>
      ${
        // The moderator's own words, when they left any. They are the difference
        // between «rejected» and a reason, and an agency that can read them
        // argues about the decision instead of about whether one was made.
        n.note ? html`<p class="ntc-note"><b>توضیح بررسی‌کننده:</b> ${n.note}</p>` : ''
      }
      ${
        shape.appeal
          ? html`<div class="ntc-act">
              <!-- The subject is filled in from the notice, so support opens the
                   ticket already knowing which decision is being argued about. -->
              <button class="btn sm" data-new-ticket="${appealSubject(n)}" data-category="APPEAL">
                ثبت اعتراض
              </button>
            </div>`
          : ''
      }
    </div>
  </article>`;
}

export function noticesPage() {
  const { data } = getState();
  const items = data.notices?.items || [];

  return html`
  <div class="card">
    <div class="card-h">
      <h2>اطلاعیه‌ها ${qtip('هر تصمیمی که سامانه درباره‌ی حساب و آگهی‌های شما گرفته است، با تاریخ و دلیل. اگر به موردی اعتراض دارید، از همین‌جا اعتراض ثبت کنید تا در بخش پشتیبانی پیگیری شود.')}</h2>
      ${items.length ? html`<span class="tag">${faDigits(items.length)} مورد</span>` : ''}
    </div>
    ${
      items.length
        ? html`<div class="ntc-list">${items.map(card)}</div>`
        : emptyBox('اطلاعیه‌ای برای شما ثبت نشده است — یعنی هیچ اخطاری روی حساب شما نیست.')
    }
  </div>`;
}
