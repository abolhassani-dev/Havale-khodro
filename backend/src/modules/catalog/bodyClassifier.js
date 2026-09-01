const { prisma } = require('../../config/database');
const logger = require('../../utils/logger');

/**
 * Which body shape a catalogue model is — decided here, not by the seller.
 *
 * The خودرو market draws a cut-out of the car and lets buyers filter by shape,
 * and both would be worthless if every seller picked the shape themselves: a
 * دنا پلاس advertised as a hatchback is not a data-entry mistake somebody
 * fixes later, it is a wrong diagram on a live advertisement. So the shape is
 * a fact of the catalogue, filled in three layers:
 *
 *   1. these rules, run at boot against models that have no value yet;
 *   2. the admin catalogue editor, for corrections and for models the rules
 *      do not know;
 *   3. a sedan fallback at display time for whatever is still null — sedan is
 *      the majority shape, and a wrong-but-plausible outline beats no page.
 *
 * The rules only ever write into NULL. That is the entire safety story: an
 * admin's correction — including an explicit «سدان» — can never be undone by
 * a rule, because a corrected row is no longer null. Which is also why the
 * column has no database default.
 *
 * Rules are matched against «برند مدل» normalised (Arabic ی/ک folded, Persian
 * and Arabic digits turned Latin, Latin lowercased). Order matters: the وانت
 * words outrank everything («تندر ۹۰ وانت» is a pickup, not whatever تندر
 * would be), and brand-scoped rules come before loose model names so «جیلی
 * اطلس» (an SUV) does not fall into سایپا اطلس (a hatchback).
 */

const DIGITS = { '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9', '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9' };

function normalise(text) {
  return String(text)
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[۰-۹٠-٩]/g, (d) => DIGITS[d])
    .replace(/[‌‌]/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Each rule: [regex over the normalised «برند مدل», body type].
const RULES = [
  // ── وانت و دوکابین — first, because the word ends the argument ──────────
  [/وانت|پیکاپ|پیک اپ|دوکابین|دو کابین|تک کابین|کمپرسی/, 'PICKUP'],
  [/^کاپرا |^زامیاد |^آریسان|^ریچ /, 'PICKUP'],
  [/هایلوکس|تونلند|وینگل|پوئر|دی مکس|d-?max|آماروک|amarok|رنجر(?! روور)|ranger/, 'PICKUP'],
  // Brand-scoped rules use `.*` after the brand, because model names repeat
  // the brand: the row is «هایما | هایما S5», so the haystack starts
  // «هایما هایما…» and `^هایما (اس|s)` would never fire.
  [/^فورد .*((اف|f)-? ?150|\bf-?\d)/, 'PICKUP'],
  [/پراید 151/, 'PICKUP'],
  [/^کی ام سی .*(تی|t) ?8/, 'PICKUP'],
  [/^فوتون .*(ساوانا|sauvana)/, 'SUV'],
  [/^فوتون /, 'PICKUP'],

  // ── شاسی‌بلند و کراس‌اوور ────────────────────────────────────────────────
  [/شاسی بلند|کراس اور|کراس اوور|( |^)کراس( |$)/, 'SUV'],
  [/^جیپ |^لندرور |^لند رور |^هامر /, 'SUV'],
  [/لندکروزر|لند کروزر|لندکروز|پرادو|راوفور|راو 4|rav ?4|هایلندر|فورچونر|سی اچ ار|ch-?r|سکویا|فور رانر|4 ?runner|ونزا/, 'SUV'],
  [/توسان|توکسان|سانتافه|سانتا فه|کرتا|کریتا|پالیساید|پالیسید|وراکروز|کونا|ix ?35|ای ایکس 35|آی ایکس 35|ix ?55/, 'SUV'],
  [/اسپورتیج|اسپرتیج|سورنتو|سلتوس|موهاوی|استونیک|سونت|تلوراید/, 'SUV'],
  [/پاترول|ایکس تریل|x-?trail|قشقایی|مورانو|جوک|کیکس|روگ|پث فایندر|پاتفایندر|پات فایندر/, 'SUV'],
  [/پاجرو|اوتلندر|ای اس ایکس|asx|اکلیپس کراس/, 'SUV'],
  [/داستر|کولیوس|کپچر|استپ وی/, 'SUV'],
  [/تیگو|tiggo|تیگارد|( |^)(ایکس|x) ?(22|33|55|66)( |$)/, 'SUV'],
  [/^فونیکس .*(اف ایکس|fx)\b/, 'SUV'],
  [/^جک .*\b(اس|s) ?[35]\b/, 'SUV'],
  [/^هایما .*((اس|s) ?[578]|8 ?(اس|s)|7 ?(ایکس|x))\b/, 'SUV'],
  [/^لیفان .*(ایکس|x) ?[567]0/, 'SUV'],
  [/^ام جی .*(جی اس|زد اس|اچ اس|\bgs\b|\bzs\b|\bhs\b|\brx\b)/, 'SUV'],
  [/^بی وای دی .*(\b(اس|s) ?6\b|سانگ|تانگ|آتو ?3|اتو ?3|sealion|سی لاین)/, 'SUV'],
  [/^جیلی .*(اطلس|(ایکس|x) ?7|امگرند ایکس)/, 'SUV'],
  [/تیوولی|کوراندو|رکستون|اکتیون|موسو/, 'SUV'],
  [/هاوال|haval|^گریت وال .*(اچ|h) ?\d/, 'SUV'],
  [/^چانگان .*(سی اس|cs) ?\d/, 'SUV'],
  [/^کی ام سی .*((کی|k) ?7|(جی|j) ?7|(ایکس|x) ?5)/, 'SUV'],
  [/تیگوان|توارگ|طوارق/, 'SUV'],
  [/^آئودی .*(کیو|q) ?[3578]\b/, 'SUV'],
  [/^ب ام و .*(ایکس|x) ?[1-7]\b/, 'SUV'],
  [/^بنز .*(جی ال|\bgl[abces]?\b|ام ال|\bml\b|جی کلاس|g کلاس)/, 'SUV'],
  [/^لکسوس .*(ار ایکس|ان ایکس|یو ایکس|جی ایکس|ال ایکس|\brx|\bnx|\bux|\bgx|\blx)/, 'SUV'],
  [/سی ار وی|اچ ار وی|cr-?v|hr-?v|پایلوت/, 'SUV'],
  [/^مزدا .*(سی ایکس|cx)/, 'SUV'],
  [/فورستر|اوتبک|( |^)xv( |$)/, 'SUV'],
  [/کپتیوا|تاهو|سوبربن|بلیزر|تراورس|اکوینوکس/, 'SUV'],
  [/اکسپلورر|اسکیپ|برونکو|اکو اسپرت|اکواسپرت|اج ?اس یو وی|کوگا/, 'SUV'],
  [/دیفندر|دیسکاوری|رنجروور|رنج روور|فریلندر/, 'SUV'],
  [/گراند ویتارا|ویتارا/, 'SUV'],

  // ── هاچبک ────────────────────────────────────────────────────────────────
  [/هاچبک|هاچ بک/, 'HATCHBACK'],
  [/پژو 205|پژو 106|پژو 107|پژو 108|پژو 208/, 'HATCHBACK'],
  [/پژو 20[67](?!.*(صندوق|sd))/, 'HATCHBACK'],
  [/پراید 111|پراید 141|^پراید هاچ/, 'HATCHBACK'],
  [/تیبا ?2/, 'HATCHBACK'],
  [/^کوییک/, 'HATCHBACK'],
  [/^اطلس /, 'HATCHBACK'],
  [/^هیوندای .*(آی|i) ?[123]0\b/, 'HATCHBACK'],
  [/پیکانتو|^کیا .*سول\b/, 'HATCHBACK'],
  [/ساندرو/, 'HATCHBACK'],
  [/^رنو .*(کلیو|\b5\b|پی کی|\bpk\b)/, 'HATCHBACK'],
  [/^فولکس .*(گلف|پولو)/, 'HATCHBACK'],
  [/زانتیا/, 'HATCHBACK'],
  [/سوئیفت/, 'HATCHBACK'],
  [/^برلیانس .*(اچ|h) ?(220|230|320)/, 'HATCHBACK'],
  [/^ام وی ام .*110\b/, 'HATCHBACK'],
  [/^مینی |^اسمارت /, 'HATCHBACK'],
  [/میراژ/, 'HATCHBACK'],
];

/** The rule verdict for one «برند مدل» name, or null when no rule knows it. */
function classify(brandName, modelName) {
  const name = normalise(`${brandName} ${modelName}`);
  for (const [pattern, type] of RULES) {
    if (pattern.test(name)) return type;
  }
  return null;
}

/**
 * Fills bodyType for every model that has none. Runs at boot, costs one query
 * once the backlog is done, and never touches a row a person has set.
 */
async function classifyUnsetBodyTypes() {
  const unset = await prisma.carModel.findMany({
    where: { bodyType: null },
    select: { id: true, name: true, brand: { select: { name: true } } },
  });
  if (!unset.length) return { examined: 0, classified: 0 };

  let classified = 0;
  const byType = { SEDAN: [], HATCHBACK: [], SUV: [], PICKUP: [] };
  for (const model of unset) {
    const type = classify(model.brand.name, model.name);
    if (type) byType[type].push(model.id);
  }
  for (const [type, ids] of Object.entries(byType)) {
    if (!ids.length) continue;
    await prisma.carModel.updateMany({ where: { id: { in: ids } }, data: { bodyType: type } });
    classified += ids.length;
  }
  logger.info(
    `body types: ${classified}/${unset.length} classified ` +
      `(hatch ${byType.HATCHBACK.length}, suv ${byType.SUV.length}, pickup ${byType.PICKUP.length}); ` +
      `the rest read as sedan until someone says otherwise`
  );
  return { examined: unset.length, classified };
}

module.exports = { classify, classifyUnsetBodyTypes, normalise };
