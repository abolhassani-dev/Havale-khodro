/**
 * Tying a catalogue model to a line in the market price list.
 *
 * The two lists were written by different people for different reasons and
 * they do not line up. Ours is far more specific: «پژو 207 اتوماتیک» is one
 * line on the price list and our catalogue splits it into a TU5 and a TU5P.
 * «کمری» is one line and twenty-one of our models, from a 2.0 to a 2.5 گرند,
 * and those are not the same money.
 *
 * That asymmetry decides the direction of the match. Reading price line →
 * catalogue model asks «which of these twenty-one cars is this price for?»,
 * which has no answer. Reading catalogue model → price line asks «which line
 * covers this car?», which usually does: the model's own name carries the
 * words that pick the line out. Measured on the real data, the first
 * direction linked 53 cars and got several of them wrong; this one links 202
 * and the domestic ones check out by hand.
 *
 * Two rules keep it honest.
 *
 *   Every word of the price line has to appear in the model's name. The line
 *   is the shorter, vaguer side, so this is the only containment that can
 *   succeed at all.
 *
 *   Where several lines fit, the most specific wins, and only if it wins
 *   alone. «پژو 207 پانوراما اتوماتیک TU5» is covered by both «پژو 207
 *   اتوماتیک» and «پژو 207 اتوماتیک پانوراما»; the second says more and is
 *   right. A tie links nothing.
 *
 * Whatever is left over shows no price at all, and that is the point. A
 * missing line costs a reader nothing; a wrong one costs the reference we are
 * trying to build. Nothing is queued for approval either — the clear ones
 * link themselves, and the rest simply stay blank until somebody chooses to
 * set one by hand.
 *
 * Worth knowing when reading the coverage: the source prices new cars only.
 * It has no پراید, no تیبا, no ۲۰۶ — so those never get a line, which is
 * correct rather than a gap to close.
 */

/** ی/ک, ZWNJ, Persian digits, punctuation — the folding the catalogue search uses. */
function fold(text) {
  return String(text || '')
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[‌‎‏]/g, ' ')
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .toLowerCase()
    // A full stop between two digits is a decimal point and stays. Letting it
    // split «1.5 لیتر» into «1» and «5» invented a «5» that matched the «5» in
    // «ام جی 5», and an آرتابان آرتان was linked to an MG's price.
    .replace(/(?<!\d)\.|\.(?!\d)/g, ' ')
    .replace(/[()،,\-/_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The key a price line is filed under, and the key a catalogue model points at.
 *
 * The whole name, brackets and all. Dropping the bracketed part looked tidier
 * and was wrong: «سورن (TU5P)» and «سورن XU7P» collapsed into one key «سورن»,
 * and a «سمند سورن پلاس EF7 بنزینی» then matched it and would have been shown
 * the price of a different engine. Keeping the words means a line that names a
 * detail only matches a model naming the same detail, and otherwise matches
 * nothing — the direction to be wrong in.
 */
function priceKey(name) {
  return fold(name);
}

const words = (text) => fold(text).split(' ').filter(Boolean);

/* Every catalogue name below was read out of the brand table, not guessed. */
const BRAND_ALIASES = {
  'ایران خودرو': ['پژو', 'سمند', 'دنا', 'رانا', 'تارا', 'آریسان', 'پیکان'],
  سایپا: ['پراید', 'تیبا', 'ساینا', 'کوییک', 'شاهین', 'اطلس', 'سهند', 'زامیاد'],
  'مدیران خودرو': ['ام وی ام', 'چری', 'فونیکس', 'اکستریم'],
  'کرمان موتور': ['کی ام سی', 'جک', 'لیفان', 'هایما'],
  'بهمن موتور': ['دیگنیتی', 'فیدلیتی', 'ریسپکت', 'کاپرا', 'مزدا'],
  'بی‌ام‌و': ['ب ام و'],
  'کیا موتورز': ['کیا'],
  'فولکس‌واگن': ['فولکس'],
  'بی‌وای‌دی': ['بی وای دی'],
  گک: ['جی ای سی'],
  // The source files Lexus under Toyota; our catalogue gives it its own marque.
  'تویوتا': ['تویوتا', 'لکسوس'],
  // The source's own miscellany drawer. It holds cars from a dozen different
  // makers, so it can vouch for none of them and links nothing — deliberately,
  // not as a side effect of having no alias.
  'سایر شرکت ها': [],
};

/**
 * The catalogue brand words a price line's maker may legitimately appear under.
 *
 * Two reasons the names differ. The source files domestic cars under the
 * factory — «ایران خودرو» — where our catalogue files them under the marque,
 * so one name on their side is seven on ours. And the imported ones are simply
 * spelled differently. Written out rather than fuzzy-matched: the list is
 * eleven entries that change about never, and a fuzzy rule would buy nothing
 * and cost the certainty this guard exists to provide.
 */
function brandCandidates(priceBrand) {
  // «ولوو - Volvo» — the Persian half is the one our catalogue uses.
  const fa = String(priceBrand || '').split(' - ')[0].trim();
  return (BRAND_ALIASES[fa] || [fa]).map(fold).filter(Boolean);
}

/**
 * Does this catalogue model plausibly come from this maker?
 *
 * A guard, not a matcher. Its job is to throw out a name collision — «ترا»
 * the Nissan against «ایکس ترا», another one — before a lone survivor is
 * mistaken for a confident answer.
 */
function brandAgrees(priceBrand, catalogueBrandName) {
  const fa = String(priceBrand || '').split(' - ')[0].trim();
  const allowed = brandCandidates(priceBrand);
  // A declared empty list means «this maker vouches for nobody». Having no
  // entry at all is different: the Persian name is used as-is, so an unlisted
  // maker still matches its own catalogue brand.
  if (BRAND_ALIASES[fa] && allowed.length === 0) return false;
  if (!catalogueBrandName) return false;
  const brand = fold(catalogueBrandName);
  // The whole name, not a piece of it. «آرتابان (ای ام جی)» contains the words
  // «ام جی» and was accepted as MG, which put an MG's price on an Artan. Every
  // name in the alias table was copied out of the brand table, so they match
  // exactly or they do not match.
  return allowed.some((c) => brand === c);
}

/**
 * The distinct cars in a price snapshot, each with its words counted once.
 *
 * Rows sharing a key — the same car listed twice — become one entry, because
 * what a model links to is the car, and the price shown for it is the range
 * across every row under that key.
 */
function buildFamilies(items) {
  const map = new Map();
  for (const item of items) {
    const key = priceKey(item.name);
    if (!key) continue;
    if (!map.has(key)) {
      map.set(key, { key, brand: item.brand, name: item.name, words: words(item.name) });
    }
  }
  return [...map.values()];
}

/**
 * The one price line that covers this catalogue model, or null.
 *
 * @param {{name: string, brand: string}} model    brand as its plain name
 * @param {Array} families                          from `buildFamilies`
 */
function bestMatch(model, families) {
  const has = new Set(words(model.name));
  const fits = families.filter(
    (f) => f.words.length && f.words.every((w) => has.has(w)) && brandAgrees(f.brand, model.brand)
  );
  if (!fits.length) return null;
  const longest = Math.max(...fits.map((f) => f.words.length));
  const top = fits.filter((f) => f.words.length === longest);
  // A tie means two lines describe this car equally well and we cannot tell
  // which is meant. Linking either would be a coin toss printed as a fact.
  return top.length === 1 ? top[0] : null;
}

module.exports = {
  fold,
  priceKey,
  words,
  brandAgrees,
  brandCandidates,
  buildFamilies,
  bestMatch,
  BRAND_ALIASES,
};
