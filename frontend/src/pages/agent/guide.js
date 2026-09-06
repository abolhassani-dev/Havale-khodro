import { html, raw } from '../../ui/html.js';
import { getState, setState } from '../../state/store.js';
import { auth } from '../../api/index.js';
import { toast } from '../../ui/feedback.js';
import { faDigits } from '../../ui/format.js';
import { go } from '../../router.js';
import { CHAPTERS, chapterById } from '../../content/guide.js';

/**
 * The guide, inside the panel.
 *
 * The same chapters as the PDF, one at a time, with the chapter list beside
 * them. One chapter rather than all fifteen stacked, because on a phone a
 * fifteen-chapter page is a scroll nobody finishes — and a reader who came
 * here from «راهنمای این بخش» wants the one chapter, not a search for it.
 *
 * The first visit is different. An account that has not confirmed the guide
 * is sent here by the router before anything else (the same gate as the
 * forced password change, one step later), and the page carries a welcome and
 * a confirm button until it does. The button is always available: the point
 * is that they have seen where the guide is and what it covers, not that
 * they have been made to read every page of it before posting a حواله.
 *
 * Static content, no loader: nothing here can fail.
 */

export async function loadGuide(params) {
  return { chapter: chapterById(params.ch) ? params.ch : CHAPTERS[0].id };
}

function chapterLink(c, current) {
  return html`<a class="${c.id === current ? 'on' : ''}" data-go="guide" data-go-params="ch=${c.id}">
    <span class="gn">${c.num ? faDigits(c.num) : '★'}</span>${c.title}
  </a>`;
}

export function guidePage() {
  const { user, data } = getState();
  const current = data.chapter || CHAPTERS[0].id;
  const i = CHAPTERS.findIndex((c) => c.id === current);
  const chapter = CHAPTERS[i] || CHAPTERS[0];
  const prev = CHAPTERS[i - 1];
  const next = CHAPTERS[i + 1];
  const gated = user && !user.guideSeen;

  return html`
  ${
    gated
      ? html`<div class="banner guide-welcome">
          <span class="b-ico">👋</span>
          <div class="b-txt">
            <b>به فرانوکار خوش آمدید.</b>
            پیش از شروع، یک بار این راهنما را ورق بزنید: هر بخش سامانه یک فصل دارد، با تصویر و قانون‌هایش.
            هر وقت خواستید، از منو دوباره به آن برمی‌گردید.
          </div>
        </div>`
      : ''
  }
  <div class="guide">
    <!-- Two copies of the same list, one per screen. On a desk an always-open
         list beside the text; on a phone the list folds behind the current
         chapter's name, and picking one re-renders the page, which closes it
         again. A closed <details> hides its children whatever the stylesheet
         says, so one element cannot be both — hence two, each shown at one
         breakpoint. No script, no state to keep. -->
    <nav class="guide-nav card guide-desk">
      <div class="card-h"><h2>فصل‌ها</h2></div>
      <div class="guide-list">${CHAPTERS.map((c) => chapterLink(c, chapter.id))}</div>
    </nav>
    <details class="guide-nav card guide-phone">
      <summary class="guide-pick">
        <span class="gn">${chapter.num ? faDigits(chapter.num) : '★'}</span>
        <span class="gt">${chapter.title}</span>
        <span class="gc">فصل‌ها ▾</span>
      </summary>
      <div class="guide-list">${CHAPTERS.map((c) => chapterLink(c, chapter.id))}</div>
    </details>
    <article class="guide-body card">
      <div class="card-h">
        <h2>${chapter.num ? `فصل ${faDigits(chapter.num)} — ` : ''}${chapter.title}</h2>
      </div>
      <div class="guide-text">${raw(chapter.body)}</div>
      <div class="guide-foot">
        ${prev ? html`<a class="btn" data-go="guide" data-go-params="ch=${prev.id}">‹ ${prev.title}</a>` : html`<span></span>`}
        ${next ? html`<a class="btn" data-go="guide" data-go-params="ch=${next.id}">${next.title} ›</a>` : html`<span></span>`}
      </div>
    </article>
  </div>
  ${
    gated
      ? html`<div class="guide-ack">
          <span>راهنما همیشه از منو در دسترس است.</span>
          <button class="btn primary" data-guide-ack>راهنما را دیدم، ادامه می‌دهم</button>
        </div>`
      : ''
  }`;
}

/**
 * The confirmation. Recorded on the server, mirrored into the session at
 * once, and then the reader goes where they were headed: the dashboard.
 */
export async function ackGuide() {
  try {
    const user = await auth.guideSeen();
    setState({ user: { ...getState().user, ...user, guideSeen: true } });
    toast('خوش آمدید — از داشبورد شروع کنید');
    go('dash');
  } catch (err) {
    toast(err.message || 'ثبت نشد — دوباره تلاش کنید', 'danger');
  }
}
