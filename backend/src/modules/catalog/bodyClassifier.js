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
    .replace(/[\u064B-\u0652\u0670]/g, '') // «جی ام سی» sometimes carries a kasra
    .replace(/[۰-۹٠-٩]/g, (d) => DIGITS[d])
    .replace(/[‌‌]/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Each rule: [regex over the normalised «برند مدل», body type].
//
// Two hard-won regex lessons hold everywhere in this table:
//   - `\b` only works next to Latin letters and digits. Persian letters are
//     not word characters, so `سول\b` never matches anything — spell the
//     boundary out as `( |$)` instead.
//   - Loose Persian words are substrings waiting to happen: «وانت» sits
//     inside «لوانته» and «آوانته», «ونزا» inside «مونزا», «رنجر» inside
//     «رنجرور». Anchor the short ones with `( |^)`/`( |$)` or scope them to
//     a brand.
const RULES = [
  // ── وانت و دوکابین — first, because the word ends the argument ──────────
  [/(^|[ (])وانت($|[ )])|پیکاپ|پیک اپ|دوکابین|دو کابین|تک کابین|کمپرسی/, 'PICKUP'],
  [/^کاپرا |^زامیاد |^آریسان|^ریچ |^پادرا موتور |^اکستریم |^زد ایکس اتو /, 'PICKUP'],
  [/هایلوکس|تونلند|وینگل|پوئر|دی مکس|d-?max|آماروک|amarok|( |^)رنجر( |$)|ranger(?! ?rover)|ناوارا|توندرا|سیلورادو|استاوت/, 'PICKUP'],
  // Brand-scoped rules use `.*` after the brand, because model names repeat
  // the brand: the row is «هایما | هایما S5», so the haystack starts
  // «هایما هایما…» and `^هایما (اس|s)` would never fire.
  [/^فورد .*((اف|f)-? ?150|\bf-?\d)/, 'PICKUP'],
  [/پراید 151/, 'PICKUP'],
  [/^کی ام سی .*(تی|t) ?[89]( |$)/, 'PICKUP'],
  [/^جی ام سی .*سیرا( |$)/, 'PICKUP'],
  [/^دوج .*( |^)رم(?! ?چارجر)/, 'PICKUP'],
  [/^ایسوزو .*( |^)kb( |$)/, 'PICKUP'],
  [/^فوتون .*(ساوانا|sauvana)/, 'SUV'],
  [/^فوتون /, 'PICKUP'],

  // ── شاسی‌بلند و کراس‌اوور ────────────────────────────────────────────────
  [/شاسی بلند|کراس اور|کراس اوور|( |^)کراس( |$)|کراس بک|اس یو وی|\bsuv\b|کراس ?تور|crosstour/, 'SUV'],
  [/^جیپ |^لندرور |^لند رور |^هامر |^تانک |^بیسو |^فیدلیتی |^لندمارک |^هن تنگ |^ریسپکت |^اس دبلیو ام |^اسکای ول |^بورگوارد |^تیگارد |^پاژن /, 'SUV'],
  // تویوتا
  [/لندکروزر|لند کروزر|لندکروز|پرادو|راوفور|راو 4|rav ?4|هایلندر|فورچونر|فرچونر|سی اچ ار|c-?h-?r|سکویا|فور رانر|فررانر|4 ?runner|( |^)ونزا|اف جی کروز|فرانت لندر|وایلدلندر|bz ?3x|bz ?4x|bz ?5( |$)/, 'SUV'],
  // هیوندای
  [/توسان|توکسان|سانتافه|سانتا فه|کرتا|کریتا|پالیساید|پالیسید|وراکروز|کونا|ix ?35|ای ایکس 35|آی ایکس 35|ix ?55|تراکان|گالوپر|آیونیک 5/, 'SUV'],
  // کیا
  [/اسپورتیج|اسپرتیج|سورنتو|سلتوس|موهاوی|استونیک|سونت( |$)|تلوراید|رتونا|^کیا .*ev ?[59]( |$)/, 'SUV'],
  // نیسان
  [/پاترول|پاتریوت|ایکس تریل|x-?trail|قشقایی|مورانو|( |^)جوک|کیکس|( |^)روگ|پث فایندر|پاتفایندر|پات فایندر|پت فایندر|آرمادا|ایکس ترا( |$)|ترانو( |$)|رونیز|نیسان ترا( |$)/, 'SUV'],
  // میتسوبیشی
  [/پاجرو|اوتلندر|ای اس ایکس|asx|اکلیپس کراس|مونترو/, 'SUV'],
  // رنو
  [/داستر|کولیوس|کپچر|استپ وی|آرکانا/, 'SUV'],
  // چری و فونیکس و ام وی ام
  [/تیگو|tiggo|تیگارد|( |^)(ایکس|x) ?(22|33|55|66|77)( |$)/, 'SUV'],
  [/^فونیکس .*((اف ایکس|fx)\b|f ?9( |$))/, 'SUV'],
  [/^جک .*\b(اس|s) ?[35]\b/, 'SUV'],
  [/^هایما .*((اس|s) ?[578]|8 ?(اس|s)|7 ?(ایکس|x))\b/, 'SUV'],
  [/^لیفان .*(ایکس|x) ?[567]0/, 'SUV'],
  [/^ام جی .*(جی اس|زد اس|اچ اس|\bgs\b|\bzs\b|\bhs\b|rx ?\d|\brx\b)/, 'SUV'],
  [/^بی وای دی .*(\b(اس|s) ?[67]\b|سانگ|تانگ|آتو ?3|اتو ?3|sealion|سی لاین)/, 'SUV'],
  [/^جیلی .*(اطلس|(ایکس|x) ?7|امگرند ایکس|آزکارا)/, 'SUV'],
  [/تیوولی|کوراندو|رکستون|اکتیون|( |^)موسو|تورس( |$)|کایرون/, 'SUV'],
  [/هاوال|haval|^گریت وال .*(اچ|h) ?\d/, 'SUV'],
  [/^چانگان .*((سی اس|cs) ?\d|uni)/, 'SUV'],
  [/^اوشان .*uni/, 'SUV'],
  [/^کی ام سی .*((کی|k) ?7|(جی|j) ?7|(ایکس|x) ?5)/, 'SUV'],
  // فولکس
  [/تیگوان|توارگ|طوارق|تایرون|ترامونت|تی راک|t-?roc|id\.? ?4|آی دی 4|یونیکس/, 'SUV'],
  [/^آئودی .*(کیو|q) ?\d/, 'SUV'],
  [/^ب ام و .*(ایکس|x) ?[1-7]\b/, 'SUV'],
  [/^بنز .*(جی ال|\bgl[abcesk]?\d*\b|ام ال|\bml\d*\b|جی کلاس|g کلاس|کلاس g( |$))/, 'SUV'],
  [/^لکسوس .*(ار ایکس|ان ایکس|یو ایکس|جی ایکس|ال ایکس|\brx|\bnx|\bux|\bgx|\blx)/, 'SUV'],
  // هوندا
  [/سی ار وی|اچ ار وی|cr-?v|hr-?v|zr-?v|پایلوت|( |^)وزل|ens ?1/, 'SUV'],
  [/^مزدا .*(سی ایکس|cx|ez ?-?60)/, 'SUV'],
  [/فورستر|فارستر|اوتبک|^سوبارو .*( |^)xv( |$)/, 'SUV'],
  // شورولت و جی ام سی
  [/کپتیوا|تاهو|سوبربن|سابربن|بلیزر|تراورس|اکوینو|ترکس( |$)|^شورولت .*جیمی/, 'SUV'],
  [/^جی ام سی \(gmc\) .*(آکادیا|ترین( |$)|یوکان)/, 'SUV'],
  // فورد
  [/اکسپلورر|اسکیپ|برونکو|برانکو|اکو اسپرت|اکواسپرت|کوگا|اکسپدیشن|^فورد .*( |^)اج( |$)/, 'SUV'],
  [/دیفندر|دیسکاوری|رنجروور|رنج روور|رنجرور|فریلندر/, 'SUV'],
  [/گراند ویتارا|ویتارا|جیمنی|سامورایی|فرانکس/, 'SUV'],
  [/^دوج .*(جرنی|دورانگو|رم ?چارجر)/, 'SUV'],
  [/^اپل .*(موکا|فرانترا)/, 'SUV'],
  [/^اینفینیتی .*(ای ایکس|اف ایکس|کیو ایکس|\bex\b|\bfx\b|qx ?\d*)/, 'SUV'],
  [/^ولوو .*(xc ?\d|ایکس سی ?\d|ex ?30)/, 'SUV'],
  [/^کادیلاک .*(srx|اسکلید)/, 'SUV'],
  [/^جگوار .*(پیس|pace)/, 'SUV'],
  [/کاروک|کودیاک|آتکا/, 'SUV'],
  [/^سیتروئن .*c ?3 xr/, 'SUV'],
  [/^جتا .*vs ?\d/, 'SUV'],
  [/^جنسیس .*(جی وی|gv) ?\d/, 'SUV'],
  [/^جی ام سی \(jmc\) .*s ?350/, 'SUV'],
  [/^جی ای سی .*(gs ?\d|جی اس ?\d|es ?9|امکو|گونو)/, 'SUV'],
  [/^بایک .*(بی جی ?\d|bj ?\d|(ایکس|x) ?\d)/, 'SUV'],
  [/^بی ای دبلیو .*212/, 'SUV'],
  [/^بی ای سی .*(ایکس|x) ?3/, 'SUV'],
  [/^بیجینگ .*(ایکس|x) ?\d/, 'SUV'],
  [/^برلیانس .*(وی|v) ?5( |$)/, 'SUV'],
  [/^روئوه .*rx/, 'SUV'],
  [/^فردا .*(sx ?\d|t ?5)/, 'SUV'],
  [/^سوئیست .*dx ?\d/, 'SUV'],
  [/^لوکسژن .*(یو|u) ?\d/, 'SUV'],
  [/^لیپ موتور .*c ?11/, 'SUV'],
  [/^ونوسیا .*(استار|وی آنلاین)/, 'SUV'],
  [/^وویا .*فری/, 'SUV'],
  [/^اوتار .*(07|11)/, 'SUV'],
  [/^مکث موتور .*کلوت/, 'SUV'],
  [/^لاماری .*ایما/, 'SUV'],
  [/^مینی .*کانتری من/, 'SUV'],
  [/^دی اس .*( |^)6( |$)/, 'SUV'],
  [/^دامای .*(ایکس|x) ?\d/, 'SUV'],
  [/^ریگان .*کوپا/, 'SUV'],
  [/^ری را /, 'SUV'],
  [/^بستیون .*(تی|t) ?\d/, 'SUV'],
  [/لوانته|تروپر|نیوا( |$)|لئوپارد/, 'SUV'],

  // ── هاچبک ────────────────────────────────────────────────────────────────
  [/هاچبک|هاچ بک|اسپرت بک|sportback/, 'HATCHBACK'],
  [/پژو 205|پژو 106|پژو 107|پژو 108|پژو 208|پژو 307|پژو 308/, 'HATCHBACK'],
  [/پژو 20[67](?!.*(صندوق|sd))/, 'HATCHBACK'],
  [/پژو 2008|پژو 3008|پژو 5008/, 'SUV'],
  [/پراید 111|پراید 141|^پراید هاچ/, 'HATCHBACK'],
  [/تیبا ?2/, 'HATCHBACK'],
  [/^کوییک/, 'HATCHBACK'],
  [/^اطلس /, 'HATCHBACK'],
  [/^هیوندای .*(آی|i) ?[123]0\b/, 'HATCHBACK'],
  [/پیکانتو|^کیا .*سول( |$)|^کیا .*سید( |$)|ولستر/, 'HATCHBACK'],
  [/ساندرو|میکرا|ماتیز|بالنو/, 'HATCHBACK'],
  [/^رنو رنو 5( |$)|^رنو .*(کلیو|پی کی|\bpk\b)/, 'HATCHBACK'],
  [/^فولکس .*(گلف|پولو|بیتل|( |^)گل( |$)|\bup\b)/, 'HATCHBACK'],
  [/زانتیا/, 'HATCHBACK'],
  [/سوئیفت|سوییفت/, 'HATCHBACK'],
  [/^برلیانس .*(اچ|h) ?(220|230|320)/, 'HATCHBACK'],
  [/^ام وی ام .*110/, 'HATCHBACK'],
  [/^مینی |^اسمارت /, 'HATCHBACK'],
  [/میراژ/, 'HATCHBACK'],
  [/^اپل .*کورسا/, 'HATCHBACK'],
  [/آئوریس|آیگو|پریوس/, 'HATCHBACK'],
  [/^هوندا .*cr-?x/, 'HATCHBACK'],
  [/^ام جی .*(ام جی 3( |$)|4 ?ev)/, 'HATCHBACK'],
  [/^اینفینیتی .*q ?30/, 'HATCHBACK'],
  [/^لکسوس .*ct ?\d/, 'HATCHBACK'],
  [/^فیات .*500/, 'HATCHBACK'],
  [/^ولوو .*(c ?30|(وی|v) ?40)( |$)/, 'HATCHBACK'],
  [/^لیپ موتور .*t ?03/, 'HATCHBACK'],
  [/ایبیزا|( |^)لئون( |$)/, 'HATCHBACK'],
  [/^سیتروئن .*c ?3( |$)/, 'HATCHBACK'],
  [/^دی اس .*( |^)3( |$)/, 'HATCHBACK'],
  [/^جیلی .*rv-?7/, 'HATCHBACK'],
  [/^بنز .*کلاس b /, 'HATCHBACK'],
  [/فیستا|فیگو|اسپارک( |$)/, 'HATCHBACK'],
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
