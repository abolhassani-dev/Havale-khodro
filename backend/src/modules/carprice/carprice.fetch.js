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
    return await readCapped(response, MAX_PAGE_BYTES, controller);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The body, up to a ceiling. A price page is a few hundred kilobytes; a
 * source that starts sending gigabytes — by mistake or otherwise — must not
 * be able to grow this container until the kernel kills it. Counted while
 * streaming, so the ceiling holds whether or not Content-Length was honest.
 */
const MAX_PAGE_BYTES = 8 * 1024 * 1024;

async function readCapped(response, limit, controller) {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > limit) throw new Error(`صفحه بزرگ‌تر از حد مجاز است (${declared} بایت)`);
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.length;
    if (total > limit) {
      controller.abort();
      throw new Error(`صفحه بزرگ‌تر از حد مجاز است (بیش از ${limit} بایت)`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
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
