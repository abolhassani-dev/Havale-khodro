const config = require('../../config');

/**
 * One page from the source, politely.
 *
 * Two requests an hour is the whole footprint of this feature, and this is
 * where it is kept that way: a timeout so a hung page cannot hold the job,
 * exactly one retry after a pause, and never two pages at once — the job
 * calls this for one group, then the other.
 */
const RETRY_AFTER_MS = 5000;

async function once(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.carPrices.timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': config.carPrices.userAgent,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'fa-IR,fa;q=0.9',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The page's HTML, or a thrown error naming both attempts. */
async function fetchPage(url) {
  try {
    return await once(url);
  } catch (first) {
    await sleep(RETRY_AFTER_MS);
    try {
      return await once(url);
    } catch (second) {
      throw new Error(`دریافت صفحه ناموفق بود: ${first.message}؛ تلاش دوم: ${second.message}`);
    }
  }
}

module.exports = { fetchPage };
