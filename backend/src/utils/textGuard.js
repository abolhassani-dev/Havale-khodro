/**
 * Contact details hiding inside free text.
 *
 * The whole business rests on a phone number not being readable until somebody
 * spends an allowance on it and the spend is recorded. A description box
 * defeats that in one line: «تماس: ۰۹۱۲۳۴۵۶۷۸۹» and the market has a free
 * directory in it.
 *
 * Two honest admissions shape everything below.
 *
 * The first: **no text filter is complete.** Digits can be spelled out, split
 * with stars, written with invisible characters between them, or replaced with
 * a Telegram handle, or with nothing at all — «نمایندگی البرز، کرج» is a
 * search away from a telephone number. Anybody who writes a filter believing
 * otherwise has written a filter that will be beaten by the second person who
 * tries. So this is one layer of several, and the layers that actually catch
 * the determined case are elsewhere: masking on the way out, a violation
 * reason competitors can report, and a review queue built from behaviour
 * rather than from text.
 *
 * The second, which decides the shape of this file: **a false positive is
 * worse than a miss.** A missed number is one leak. A rule that refuses an
 * honest listing teaches an agency that the form is broken, and they stop
 * writing descriptions at all. So the rules split in two:
 *
 *   HARD — refused at submit. Only patterns that cannot plausibly be anything
 *          else: an Iranian mobile number, an @handle, a link, and the
 *          agency's own code. A price is never «۰۹…»; a model year is never
 *          eleven digits.
 *   SOFT — never refused. Words like «تلگرام» and other digit runs. They only
 *          raise a flag for a human to look at, because «تلگرام ندارم» is a
 *          sentence somebody will write.
 */

const { ValidationError } = require('../errors/AppError');

const FA = '۰۱۲۳۴۵۶۷۸۹';
const AR = '٠١٢٣٤٥٦٧٨٩';

// Words for digits, so «صفر نهصد و دوازده» does not walk past a rule that only
// knows numerals. Ordered longest-first: replacing «سه» before «سیصد» would
// turn «سیصد» into «3د».
const SPOKEN = [
  ['نهصد', '900'], ['هشتصد', '800'], ['هفتصد', '700'], ['ششصد', '600'],
  ['پانصد', '500'], ['چهارصد', '400'], ['سیصد', '300'], ['دویست', '200'],
  ['نوزده', '19'], ['هجده', '18'], ['هفده', '17'], ['شانزده', '16'],
  ['پانزده', '15'], ['چهارده', '14'], ['سیزده', '13'], ['دوازده', '12'],
  ['یازده', '11'], ['نود', '90'], ['هشتاد', '80'], ['هفتاد', '70'],
  ['شصت', '60'], ['پنجاه', '50'], ['چهل', '40'], ['سی', '30'], ['بیست', '20'],
  ['ده', '10'], ['صد', '100'], ['نه', '9'], ['هشت', '8'], ['هفت', '7'],
  ['شش', '6'], ['پنج', '5'], ['چهار', '4'], ['سه', '3'], ['دو', '2'],
  ['یک', '1'], ['صفر', '0'],
];

/** Zero-width and directional marks — invisible, and enough to break a regex. */
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g;

/**
 * The text as a rule should see it.
 *
 * Persian and Arabic numerals folded to ASCII, invisible characters dropped,
 * spelled-out numbers turned back into digits, and the punctuation people put
 * *between* digits removed — «۰۹۱۲*۳۴۵*۶۷۸۹» and «0912 345 67 89» are the same
 * number written by somebody who knew a filter was there.
 *
 * Deliberately not destructive beyond that: the result is used for detection
 * only, never stored and never shown.
 */
function normalise(text) {
  let out = String(text ?? '')
    .replace(INVISIBLE, '')
    .replace(/[۰-۹]/g, (d) => String(FA.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(AR.indexOf(d)));

  for (const [word, digits] of SPOKEN) {
    out = out.split(word).join(digits);
  }

  // Separators between two digits, and only there: «۱۲۳-۴۵۶» collapses, but the
  // dash in «مدل ۱۴۰۵ - رنگ سفید» is left where it is.
  out = out.replace(/(?<=\d)[\s.*\-_/\\|+()[\]«»,،٬]+(?=\d)/g, '');
  return out;
}

/**
 * An Iranian mobile number.
 *
 * `09` and nine more digits, or the same with a country code. Anchored on a
 * non-digit boundary so that an eleven-digit price cannot match by accident —
 * and a price cannot begin «09» in any case.
 */
const PHONE = /(?<!\d)(?:\+?98|0098)?0?9\d{9}(?!\d)/;

/** A messenger handle: @ followed by something that looks like a username. */
const HANDLE = /@[A-Za-z0-9_]{4,}/;

/** A link or a bare domain. */
const LINK = /(?:https?:\/\/|www\.)\S+|\b[A-Za-z0-9-]{3,}\.(?:ir|com|net|org|me|co)\b/i;

/** Words that often carry an identifier after them — flagged, never refused. */
const MESSENGER = /(تلگرام|واتس\s*اپ|واتساپ|whatsapp|telegram|ایتا|روبیکا|بله|سروش|اینستا|instagram|آیدی|ایدی)/i;

/** A long digit run that is not a price and not a year — flagged, never refused. */
const LONG_DIGITS = /(?<!\d)\d{8,}(?!\d)/;

const RULES = [
  { kind: 'PHONE', hard: true, test: PHONE },
  { kind: 'HANDLE', hard: true, test: HANDLE },
  { kind: 'LINK', hard: true, test: LINK },
  { kind: 'MESSENGER', hard: false, test: MESSENGER },
  { kind: 'DIGITS', hard: false, test: LONG_DIGITS },
];

/** What to tell somebody whose text was refused. Never a list of what to try. */
const REFUSAL = {
  PHONE: 'شماره تماس',
  HANDLE: 'آیدی',
  LINK: 'لینک',
  AGENCY_CODE: 'کد نمایندگی',
};

/**
 * What the text carries.
 *
 * @param {string} text
 * @param {object} [ctx]
 * @param {string} [ctx.agencyCode]  this account's own code, which is the one
 *        identifier we know exactly — and therefore the one rule with no
 *        judgement in it at all.
 * @returns {{hard: string[], soft: string[]}} rule kinds that matched
 */
function inspect(text, { agencyCode } = {}) {
  const clean = normalise(text);
  const hard = [];
  const soft = [];

  for (const rule of RULES) {
    if (!rule.test.test(clean)) continue;
    (rule.hard ? hard : soft).push(rule.kind);
  }

  // Their own code, written into their own advertisement, is not ambiguous:
  // «G-1001» in a description is somebody telling the market who they are.
  if (agencyCode && clean.toUpperCase().includes(String(agencyCode).toUpperCase())) {
    hard.push('AGENCY_CODE');
  }

  return { hard, soft };
}

/** The Persian sentence for a refusal, naming what was found and nothing else. */
function refusalFor(field, kinds) {
  const what = kinds.map((k) => REFUSAL[k]).filter(Boolean);
  const list = what.length ? what.join(' و ') : 'اطلاعات تماس';
  return `در «${field}» نمی‌توانید ${list} بنویسید. مشخصات تماس شما با «نمایش مشخصات» به طرف مقابل داده می‌شود.`;
}

/**
 * The same patterns, blanked out rather than refused.
 *
 * The safety net under the refusal: rows written before this file existed, and
 * anything a cleverer encoding walks past the submit check, are still not
 * served to somebody who has not paid for the contact. Cheap enough to run on
 * every serialised row, and it runs on the way *out* — so nothing is destroyed
 * and the owner keeps seeing their own words.
 */
function maskContact(text) {
  if (!text) return text;

  // Masking has to happen on the original, or the reader gets back a string
  // with the spaces and the Persian digits stripped out of it. So each rule is
  // matched on the normalised copy and, when it hits, the *original* is
  // scrubbed with an equivalent loose pattern.
  const clean = normalise(text);
  let out = String(text);

  if (PHONE.test(clean)) {
    // Loose on purpose: at least eight characters that are digits or the things
    // people put between them, starting from a nine.
    out = out.replace(
      /(?:\+?۹۸|\+?98)?[\s.*\-_/\\|+()]*[0۰]?[9۹][\d۰-۹\s.*\-_/\\|+()]{8,}/g,
      '▪▪▪'
    );
  }
  if (HANDLE.test(clean)) out = out.replace(/@[A-Za-z0-9_]{4,}/g, '▪▪▪');
  if (LINK.test(clean)) out = out.replace(LINK, '▪▪▪');

  return out;
}

/**
 * Refuses a write whose free text carries contact details.
 *
 * Called from the services rather than from a Joi schema for one reason: the
 * sharpest rule needs the account's own agency code, and a validator does not
 * know who is asking. Placed in the service and not the route so that no future
 * caller can reach the write without it.
 *
 * @param {Record<string, string>} fields  label → the text under it, so the
 *        refusal can name the box the person has to go and fix
 * @param {object} [ctx]
 * @param {string} [ctx.agencyCode]
 * @returns {string[]} the soft flags, for whoever wants to record them
 */
function assertClean(fields, { agencyCode } = {}) {
  const soft = [];

  for (const [label, value] of Object.entries(fields)) {
    if (!value) continue;
    const found = inspect(value, { agencyCode });
    // No `details`: the panel prints the headline and then the detail lines
    // under it, and a single-field refusal whose only detail repeats the
    // headline word for word reads as though two separate things went wrong.
    if (found.hard.length) throw new ValidationError(refusalFor(label, found.hard));
    soft.push(...found.soft);
  }

  return [...new Set(soft)];
}

module.exports = {
  normalise,
  inspect,
  assertClean,
  refusalFor,
  maskContact,
  PHONE,
  HANDLE,
  LINK,
};
