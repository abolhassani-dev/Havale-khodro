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
 * direction linked 53 cars and got several of them wrong; this one links 173
 * and the domestic ones check out by hand.
 *
 * Three rules keep it honest.
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
 *   The maker has to agree, and where the line announces a body shape, the
 *   shape has to agree too. Both are guards rather than matchers: their job is
 *   to stop a lone survivor being mistaken for a confident answer.
 *
 * Both sides are folded the same way first, because the same car is spelled
 * two ways: «جک J4» against «جک جی 4», «راناپلاس» against «رانا پلاس»,
 * «7 نفره» against «هفت نفره», «وانت آریسان» against «آریسان», «ونوسیا STAR»
 * against «ونوسیا استار». Each of those was found by taking a marque that got
 * no price at all and asking why; none of them guesses which car is which.
 *
 * The makers differ more than the spellings do, and that is the larger half of
 * the work. The source files a car under whoever assembles it — هایما under
 * ایران خودرو, چانگان under سایپا, تانک under گریت وال — where our catalogue
 * files it under its own marque. BRAND_ALIASES is that translation, and filling
 * it in took the link from 142 models to 173. Worth reading the number the
 * right way round: the cars that showed no price were almost never missing from
 * our catalogue, they were filed under a name this table had not been told
 * about. The catalogue is the richer of the two lists, not the poorer.
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

/**
 * Spellings that mean the same car and are written differently on each side.
 *
 * Every entry below was found by looking at a brand that got no price at all
 * and asking why. None of them is a guess about which car is which — they are
 * all the same name typed two ways.
 */

/**
 * «جک جی 4» on our side, «جک J4» on theirs. The letter said aloud, or written.
 *
 * Only ever glued to a digit beside it, and both lists go through the same
 * function, so the letter chosen matters far less than choosing it
 * consistently: «ام جی 5» folds the same way on either side either way.
 */
const LETTER_SAID = {
  جی: 'j',
  اس: 's',
  ایکس: 'x',
  اچ: 'h',
  ای: 'e',
  کیو: 'q',
  زد: 'z',
  آر: 'r',
  تی: 't',
  وی: 'v',
  دی: 'd',
  ال: 'l',
  ام: 'm',
  ان: 'n',
  اف: 'f',
};

/** «هفت نفره» here, «7 نفره» there. */
const NUMBER_SAID = {
  یک: '1',
  دو: '2',
  سه: '3',
  چهار: '4',
  پنج: '5',
  شش: '6',
  هفت: '7',
  هشت: '8',
  نه: '9',
  ده: '10',
};

/**
 * A trim word written in Latin on one list and Persian on the other.
 *
 * «ونوسیا STAR» is our «ونوسیا استار», «D60 Plus» our «D60 پلاس». Both lists go
 * through this, so the side it normalises to does not matter — only that no two
 * different words are allowed to land on the same one. Kept to words that were
 * seen spelled both ways in the live lists; a bigger table would be guessing.
 */
const WORD_SAID = {
  star: 'استار',
  plus: 'پلاس',
  pro: 'پرو',
  online: 'آنلاین',
};

/**
 * A body shape the source puts in front of the name, which is not part of it.
 *
 * «وانت آریسان» is an آریسان. Only stripped from the front, because in the
 * middle of a name the same word can be the model — «نیسان ترا پیکاپ».
 *
 * The value is the catalogue body types the word allows, and it is not
 * decoration. Stripping the word can leave a line whose only remaining word is
 * the maker's own name: «پیکاپ فوتون (اتوماتیک)» became «فوتون اتوماتیک», which
 * an automatic فوتون ساوانا — an SUV — then satisfied, and a van would have
 * been shown a pickup's price. Putting the shape back as a condition is what
 * keeps that line meaning what it says.
 *
 * null means «we cannot check this one»: our catalogue has no van category, so
 * «ون» constrains nothing rather than pretending to.
 */
const SHAPE_PREFIX = new Map([
  ['وانت', ['PICKUP', 'PICKUP_SINGLE']],
  ['پیکاپ', ['PICKUP', 'PICKUP_SINGLE']],
  ['ون', null],
]);

/**
 * The words of a name, in the one spelling both sides can be compared in.
 *
 * «جی» followed by «4» becomes «j4», because the source writes the letter and
 * we spell it out. Same for «هفت» before «نفره». A leading body shape is
 * dropped.
 */
function words(text) {
  const raw = fold(text).split(' ').filter(Boolean);
  const out = [];
  for (let i = 0; i < raw.length; i += 1) {
    const w = raw[i];
    if (!out.length && SHAPE_PREFIX.has(w) && raw.length > 1) continue; // kept as `shape`, see buildFamilies
    const letter = LETTER_SAID[w];
    const next = raw[i + 1];
    // «جی 4» → «g4»: a spoken letter glued to the number that follows it.
    if (letter && next && /^\d+$/.test(next)) {
      out.push(`${letter}${next}`);
      i += 1;
      continue;
    }
    // «8 اس» → «8s», the same thing the other way round.
    if (/^\d+$/.test(w) && next && LETTER_SAID[next]) {
      out.push(`${w}${LETTER_SAID[next]}`);
      i += 1;
      continue;
    }
    out.push(NUMBER_SAID[w] || WORD_SAID[w] || w);
  }
  return out;
}

/** The name with every space closed up: «رانا پلاس» and «راناپلاس» meet here. */
const squeeze = (text) => words(text).join('');

/** The body shape this name is announced with, if any — see SHAPE_PREFIX. */
function shapeOf(text) {
  const raw = fold(text).split(' ').filter(Boolean);
  if (raw.length < 2 || !SHAPE_PREFIX.has(raw[0])) return null;
  return SHAPE_PREFIX.get(raw[0]);
}

/**
 * Every run of neighbouring words in a name, run together.
 *
 * «رانا پلاس موتور TU5» yields «رانا», «راناپلاس», «راناپلاسموتور» and so on,
 * so a source that wrote «راناپلاس» without the space still finds its car.
 *
 * Runs rather than a plain substring search, because a substring cannot see
 * where a word ends: «آریزو5» sits inside «چریآریزو5tie», and an آریزو 5T is
 * not an آریزو 5. Testing whole runs puts the boundary back.
 */
function joinedRuns(list) {
  const out = new Set();
  for (let i = 0; i < list.length; i += 1) {
    let run = '';
    for (let j = i; j < list.length; j += 1) {
      run += list[j];
      out.add(run);
    }
  }
  return out;
}

/**
 * The drawer the source puts every small importer in.
 *
 * It is not a maker, so it cannot say who made a car — but each of its lines
 * opens with the marque anyway: «لوکانو L7», «فردا SX5», «لاماری ایما». That
 * word is the only maker evidence there is, and it is enough on its own.
 */
const MISCELLANY = 'سایر شرکت ها';

/* Every catalogue name below was read out of the brand table, not guessed. */
const BRAND_ALIASES = {
  // هایما is filed here because that is where the source files it, and the
  // source is the side being read. Ours agrees: the cars are built by IKCO.
  'ایران خودرو': ['پژو', 'سمند', 'دنا', 'رانا', 'تارا', 'آریسان', 'پیکان', 'هایما', 'ری را', 'فوتون'],
  سایپا: ['پراید', 'تیبا', 'ساینا', 'کوییک', 'شاهین', 'اطلس', 'سهند', 'زامیاد', 'چانگان', 'سیتروئن'],
  'مدیران خودرو': ['ام وی ام', 'چری', 'فونیکس', 'اکستریم'],
  'کرمان موتور': ['کی ام سی', 'جک', 'لیفان'],
  'بهمن موتور': [
    'دیگنیتی',
    'فیدلیتی',
    'ریسپکت',
    'کاپرا',
    'مزدا',
    'هونگچی',
    'شوال',
    'اوتار',
    'اینوی',
    'اینرودز',
    'هاوال',
  ],
  // The source's «گریت وال» drawer holds the Tank and the Haval, which our
  // catalogue gives marques of their own.
  'گریت وال': ['گریت وال', 'تانک', 'هاوال'],
  'بی‌ام‌و': ['ب ام و'],
  'کیا موتورز': ['کیا'],
  'فولکس‌واگن': ['فولکس'],
  'بی‌وای‌دی': ['بی وای دی'],
  گک: ['جی ای سی'],
  // The source files Lexus under Toyota; our catalogue gives it its own marque.
  'تویوتا': ['تویوتا', 'لکسوس'],
  // The source's own miscellany drawer. It holds cars from a dozen different
  // makers, so it can vouch for none of them and links nothing — deliberately,
  // not as a side effect of having no alias. See MISCELLANY for the one way in.
  [MISCELLANY]: [],
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
      map.set(key, {
        key,
        brand: item.brand,
        name: item.name,
        words: words(item.name),
        squeezed: squeeze(item.name),
        shape: shapeOf(item.name),
      });
    }
  }
  return [...map.values()];
}

/**
 * Does this line's own name open with this catalogue marque?
 *
 * Only asked of the miscellany drawer, and it has to be the opening words
 * rather than any occurrence: «تیگارد تیسان S05» is our name for a car the
 * source calls «تیسان S05», and a line naming one marque must not be handed to
 * another that merely mentions it.
 */
function leadsWithBrand(familyWords, catalogueBrandName) {
  const brand = words(catalogueBrandName || '');
  if (!brand.length) return false;
  return brand.every((w, i) => familyWords[i] === w);
}

/** Who the source says makes this car, or — for the drawer — what its name says. */
function makerAgrees(family, model) {
  if (brandAgrees(family.brand, model.brand)) return true;
  const fa = String(family.brand || '').split(' - ')[0].trim();
  return fa === MISCELLANY && leadsWithBrand(family.words, model.brand);
}

/**
 * Does a line that announces a body shape describe a car of that shape?
 *
 * An unclassified model is not evidence either way and passes: two thirds of
 * the catalogue has no body type set, and refusing all of them would throw away
 * far more true links than the false one this guard exists to stop.
 */
function shapeAgrees(family, bodyType) {
  if (!family.shape || !bodyType) return true;
  return family.shape.includes(bodyType);
}

/**
 * The one price line that covers this catalogue model, or null.
 *
 * @param {{name: string, brand: string, bodyType?: string}} model  brand as its plain name
 * @param {Array} families                                          from `buildFamilies`
 */
function bestMatch(model, families) {
  const mine = words(model.name);
  const has = new Set(mine);
  const runs = joinedRuns(mine);
  const fits = families.filter(
    (f) =>
      f.words.length &&
      makerAgrees(f, model) &&
      shapeAgrees(f, model.bodyType) &&
      (f.words.every((w) => has.has(w)) || runs.has(f.squeezed))
  );
  if (!fits.length) return null;
  const longest = Math.max(...fits.map((f) => f.words.length));
  const top = fits.filter((f) => f.words.length === longest);
  // A tie means two lines describe this car equally well and we cannot tell
  // which is meant. Linking either would be a coin toss printed as a fact.
  return top.length === 1 ? top[0] : null;
}

module.exports = {
  squeeze,
  fold,
  priceKey,
  words,
  shapeOf,
  brandAgrees,
  makerAgrees,
  brandCandidates,
  buildFamilies,
  bestMatch,
  BRAND_ALIASES,
};
