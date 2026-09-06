/**
 * Reads the market price list out of the source's HTML.
 *
 * Written against two saved pages (tests/fixtures/car-prices/), which are the
 * contract: every shape this parser relies on is in them, and the unit test
 * fails the day the source changes it. The page is regular enough that a
 * handful of expressions is safer than an HTML library — there is one table,
 * a heading row per company, and one data row per car, always in that order.
 *
 * Nothing here talks to the network and nothing here touches the database:
 * a string goes in, plain objects come out, so the job, the tests and a
 * `--file` dry run all read the same code.
 */

const DIGITS = { '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9', '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9' };

const ENTITIES = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&lrm;': '', '&rlm;': '' };

/** Tags off, entities decoded, direction marks and runs of space gone. */
function text(fragment) {
  return String(fragment || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, (e) => (e in ENTITIES ? ENTITIES[e] : e))
    // Direction marks, the zero-width space and the no-break space, spelled
    // as escapes so nobody's editor quietly strips them.
    .replace(/[\u200e\u200f\u200b\u00a0]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function latinDigits(value) {
  return String(value).replace(/[۰-۹٠-٩]/g, (d) => DIGITS[d]);
}

/**
 * A price cell as a number of toman, or null.
 *
 * Null is not zero. «---», «به زودی» and «توقف فروش» are all things the source
 * says instead of a number, and each of them is kept as text beside the null.
 */
function toman(cellText) {
  const digits = latinDigits(cellText).replace(/[,،٬\s]/g, '');
  return /^\d{4,}$/.test(digits) ? BigInt(digits) : null;
}

/** «۲.۸۰%» → 2.8; nothing recognisable → null. */
function percent(cellText) {
  const m = latinDigits(cellText).replace(/[٫]/g, '.').match(/(\d+(?:\.\d+)?)\s*%/);
  return m ? Number(m[1]) : null;
}

/**
 * Which way the price moved, as the source colours it.
 *
 * The source says it twice: an inline colour (`#00cc00` up, `red` down) and,
 * for a fall, a minus in front of both numbers. Either is enough. Anything
 * else with a non-zero change is left null, and the service then decides
 * from our own previous snapshot rather than guessing.
 */
function direction(cellHtml, cellText, pct, amount) {
  if (/-\s*[\d۰-۹]/.test(cellText)) return 'DOWN';
  const colour = (cellHtml.match(/color:\s*#?([0-9a-f]{3,6}|red|green)/i) || [])[1];
  if (colour) {
    const c = colour.toLowerCase();
    if (c === 'green' || /^0{0,2}[c-f]{1,2}0{0,2}$/.test(c) || /^[0-3][0-9a-f]?[c-f][c-f]?[0-3]?[0-9a-f]?$/.test(c)) return 'UP';
    if (c === 'red' || /^[c-f][c-f]?0{1,2}0{0,2}$/.test(c)) return 'DOWN';
  }
  if (pct === 0 || amount === 0n) return 'FLAT';
  return null;
}

/**
 * The page → { stamp, secondLabel, items }.
 *
 * `secondLabel` is the third column's heading as the page prints it — «قیمت
 * کارخانه (تومان)» on one page, «قیمت نمایندگی (تومان)» on the other — so the
 * panel can show whichever the source means without a hard-coded word.
 */
function parsePage(html) {
  const source = String(html || '');
  const start = source.indexOf('class="items_table');
  if (start < 0) return { stamp: null, secondLabel: null, headings: null, items: [] };
  const tableStart = source.lastIndexOf('<table', start);
  const end = source.indexOf('</table>', start);
  const table = source.slice(tableStart, end < 0 ? undefined : end);

  const stamp = (source.match(/group-refreshdate-wrapper"[^>]*>([^<]+)</) || [])[1];

  let secondLabel = null;
  let headings = null;
  let brand = null;
  const items = [];

  for (const row of table.matchAll(/<tr([^>]*)>([\s\S]*?)<\/tr>/g)) {
    const [, attrs, body] = row;
    if (/catsection/.test(attrs)) {
      brand = text(body);
      continue;
    }
    if (/class="header"/.test(attrs)) {
      const heads = [...body.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((h) => text(h[1]));
      if (!headings) headings = heads;
      if (!secondLabel && heads[2]) secondLabel = heads[2];
      continue;
    }
    // The chart rows that follow every car — an empty box the page fills on
    // click — are not cars.
    if (/expand/.test(attrs)) continue;

    const cells = [...body.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1]);
    if (cells.length < 4) continue;
    const id = (body.match(/data-target="(\d+)"/) || [])[1];
    const name = text(cells[0]);
    if (!id || !name) continue;

    const priceText = text(cells[1]);
    const secondText = text(cells[2]);
    // The change cell is «(۲.۸۰%)» beside an amount; both may be zero.
    const changeText = text(cells[3]);
    const pct = percent(changeText);
    const amountMatch = latinDigits(changeText).replace(/\([^)]*\)/g, '').match(/\d[\d,]*/);
    const amount = amountMatch ? BigInt(amountMatch[0].replace(/,/g, '')) : null;

    items.push({
      id,
      brand,
      name,
      priceToman: toman(priceText),
      priceText,
      secondToman: toman(secondText),
      secondText,
      changeToman: amount,
      changePct: pct,
      direction: direction(cells[3], changeText, pct, amount),
      sortOrder: items.length,
    });
  }

  return { stamp: stamp ? text(stamp) : null, secondLabel, headings, items };
}

/**
 * What the columns must be called for the numbers to mean what we store.
 *
 * The parser reads cells by position, so a page whose columns moved would
 * be read perfectly and stored wrong — the factory price where the market
 * price goes. The headings are the one thing on the page that says which is
 * which, so a page whose headings are not the expected ones is refused,
 * however many rows it has. Returns the complaint, or null.
 */
function headingProblem(headings) {
  if (!headings || headings.length < 4) return 'سرستون‌های جدول پیدا نشد';
  const want = [/نام خودرو/, /قیمت بازار/, /قیمت (کارخانه|نمایندگی)/, /تغییر/];
  for (let i = 0; i < want.length; i += 1) {
    if (!want[i].test(headings[i])) {
      return `ساختار جدول عوض شده — ستون ${i + 1} «${headings[i] || ''}» است`;
    }
  }
  return null;
}

module.exports = { parsePage, headingProblem, text, toman, percent, latinDigits };
