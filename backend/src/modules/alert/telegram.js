const https = require('https');
const config = require('../../config');
const logger = require('../../utils/logger');

/**
 * Alerts to Telegram.
 *
 * The reason this exists rather than "check the logs": nobody reads logs on a
 * server they are not already looking at. Every failure this project has hit so
 * far announced itself as a blank page hours later — the Prisma engine on
 * Alpine, the demo seed restart loop, the session cookie, the stale mount. Each
 * had a clear message in a log file nobody had a reason to open.
 *
 * Deliberately dependency-free and fire-and-forget. An alerting channel that
 * can throw, block, or fail a request is a second outage waiting to happen: if
 * Telegram is unreachable — which, from Iran, it regularly is — the
 * application must not notice.
 *
 * Rate limited per message kind, because the failure worth alerting on is
 * usually the one that repeats a thousand times a minute, and a thousand
 * notifications is the same as none.
 */

const lastSent = new Map();
const DEFAULT_COOLDOWN_MS = 15 * 60 * 1000;

function enabled() {
  return Boolean(config.alerts?.telegram?.token && config.alerts?.telegram?.chatId);
}

/** Telegram's MarkdownV2 escapes almost everything; HTML mode needs only three. */
function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function post(text) {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      chat_id: config.alerts.telegram.chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });

    const req = https.request(
      {
        hostname: 'api.telegram.org',
        path: `/bot${config.alerts.telegram.token}/sendMessage`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: 8000,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode >= 200 && res.statusCode < 300);
      }
    );

    // Every failure path resolves rather than rejects. A monitoring system that
    // can take the application down is worse than no monitoring system.
    req.on('error', (err) => {
      logger.warn('Telegram alert failed', { error: err.message });
      resolve(false);
    });
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.write(body);
    req.end();
  });
}

/**
 * @param {object} alert
 * @param {string} alert.title     what broke, in one line
 * @param {string} [alert.detail]  the message or figures
 * @param {string} [alert.help]    what to actually do about it — the part that
 *                                 turns a 3am notification into a fix
 * @param {string} [alert.key]     dedup key; repeats within the cooldown are dropped
 * @param {'info'|'warn'|'error'} [alert.level]
 */
async function send({ title, detail, help, key, level = 'error', cooldownMs = DEFAULT_COOLDOWN_MS }) {
  if (!enabled()) return false;

  const dedupKey = key || title;
  const now = Date.now();
  const previous = lastSent.get(dedupKey);
  if (previous && now - previous < cooldownMs) return false;
  lastSent.set(dedupKey, now);

  const icon = { info: 'ℹ️', warn: '⚠️', error: '🔴' }[level] || '🔴';
  const when = new Intl.DateTimeFormat('fa-IR', {
    timeZone: 'Asia/Tehran',
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(new Date());

  const lines = [
    `${icon} <b>${escapeHtml(title)}</b>`,
    `<i>فرانوکار · ${escapeHtml(when)}</i>`,
  ];
  if (detail) lines.push('', `<pre>${escapeHtml(String(detail).slice(0, 1500))}</pre>`);
  if (help) lines.push('', `🔧 <b>راه‌حل:</b>`, escapeHtml(help));

  return post(lines.join('\n'));
}

/** Clears the cooldown table. Tests only. */
function reset() {
  lastSent.clear();
}

module.exports = { send, enabled, reset };
