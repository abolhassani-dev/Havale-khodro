const { classify } = require('../../src/modules/catalog/bodyClassifier');

/**
 * The rules that decide a model's body shape.
 *
 * Each case here is a real catalogue row (brand, model) — including the ones
 * that bit during development: model names repeat the brand («هایما | هایما
 * S5»), so brand-anchored rules must tolerate the doubled word; «206 SD» is a
 * sedan while plain «206» is a hatchback; «تندر ۹۰ وانت» must be a pickup no
 * matter what تندر alone would be.
 */
describe('body classifier', () => {
  const cases = [
    // hatchbacks
    ['پژو', 'پژو 206 تیپ 2', 'HATCHBACK'],
    ['پژو', 'پژو 207 پانوراما اتوماتیک TU5', 'HATCHBACK'],
    ['کوییک', 'کوییک دنده ای R', 'HATCHBACK'],
    ['پراید', 'پراید 111 SE', 'HATCHBACK'],
    ['تیبا', 'تیبا 2 پلاس', 'HATCHBACK'],
    ['اطلس', 'اطلس دنده ای تیپ G', 'HATCHBACK'],
    ['رنو', 'رنو ساندرو اتوماتیک', 'HATCHBACK'],
    ['رنو', 'رنو 5 (مونتاژ)', 'HATCHBACK'],
    ['هیوندای', 'هیوندای i20', 'HATCHBACK'],
    ['جک', 'جک جی 3 هاچ بک', 'HATCHBACK'],

    // sedans — by falling through to null, which the panel reads as سدان
    ['پژو', 'پژو 206 SD V8', null],
    ['پژو', 'پژو 207 صندوقدار اتوماتیک', null],
    ['دنا', 'دنا پلاس EF7 6 دنده توربو', null],
    ['شاهین', 'شاهین اتوماتیک CVT تیپ G', null],
    ['تارا', 'تارا اتوماتیک V2', null],
    ['تیبا', 'تیبا صندوق دار پلاس', null],
    ['فونیکس', 'فونیکس آریزو 6 پرو', null],
    ['جک', 'جک جی 3 سدان', null],
    ['سمند', 'سمند LX ساده', null],

    // SUVs and crossovers
    ['چری', 'چری تیگو 5 لاکچری', 'SUV'],
    ['ام وی ام', 'ام وی ام X22 دنده ای ساده', 'SUV'],
    ['هایما', 'هایما S5 گیربکس CVT', 'SUV'],
    ['هایما', 'هایما 8S', 'SUV'],
    ['فونیکس', 'فونیکس FX اکسلنت', 'SUV'],
    ['رنو', 'رنو ساندرو استپ وی اتوماتیک', 'SUV'],
    ['تویوتا', 'تویوتا لندکروزر GXR', 'SUV'],
    ['هیوندای', 'هیوندای سانتافه 2400', 'SUV'],
    ['لندرور', 'لندرور دیفندر P400', 'SUV'],
    ['ب ام و', 'ب ام و X3 25', 'SUV'],
    ['شاهین', 'شاهین کراس اتوماتیک', 'SUV'],

    // pickups — double cab
    ['تویوتا', 'تویوتا هایلوکس دو کابین بلند', 'PICKUP'],
    ['ایسوزو', 'ایسوزو دی مکس دو کابین', 'PICKUP'],
    ['زامیاد', 'زامیاد ریچ', 'PICKUP'],
    ['کاپرا', 'کاپرا U دوکابین 2.4 لیتر اتوماتیک', 'PICKUP'],
    ['نیسان', 'نیسان پیکاپ دو کابین', 'PICKUP'],

    // pickups — single cab, a shape of its own with no rear doors. The cab
    // words outrank every brand rule, in both directions: کاپرا and گریت وال
    // build both, and زامیاد builds only single cabs except ریچ.
    ['زامیاد', 'زامیاد Z24 بنزینی', 'PICKUP_SINGLE'],
    ['زامیاد', 'زامیاد شوکا', 'PICKUP_SINGLE'],
    ['پراید', 'پراید 151 پلاس', 'PICKUP_SINGLE'],
    ['رنو', 'رنو تندر 90 وانت', 'PICKUP_SINGLE'],
    ['آریسان', 'آریسان 2', 'PICKUP_SINGLE'],
    ['پیکان', 'پیکان وانت بنزین', 'PICKUP_SINGLE'],
    ['کاپرا', 'کاپرا B تک کابین 2.0 لیتر دنده ای', 'PICKUP_SINGLE'],
    ['گریت وال', 'گریت وال وینگل 5 تک کابین تک دیفرانسیل', 'PICKUP_SINGLE'],
    ['مزدا', 'مزدا وانت تک‌کابين', 'PICKUP_SINGLE'],
    ['تویوتا', 'تویوتا هایلوکس تک کابین', 'PICKUP_SINGLE'],

    // an import nobody wrote a rule for stays unclassified, not guessed
    ['مازراتی', 'مازراتی گرن توریسمو', null],

    // ── the full-catalogue review, صفر تا صد ────────────────────────────────
    // «وانت» is a substring trap: لوانته and آوانته contain it. A pickup is a
    // pickup only when وانت stands as its own word.
    ['مازراتی', 'مازراتی لوانته S', 'SUV'],
    ['هیوندای', 'هیوندای آوانته اتوماتیک', null],
    ['دوج', 'دوج رم چارجر (وانت)', 'PICKUP_SINGLE'],
    ['دوج', 'دوج رم چارجر', 'SUV'],
    ['دوج', 'دوج رم 1500', 'PICKUP'],
    // «رنجرور» is Range Rover, not a Ranger pickup.
    ['لندرور', 'لندرور رنجرور ولار P250', 'SUV'],
    // «ونزا» hides inside «مونزا», and the Teana XV is not a Subaru XV.
    ['شورولت', 'شورولت مونزا', null],
    ['نیسان', 'نیسان تیانا (مونتاژ) XV', null],
    ['سوبارو', 'سوبارو XV', 'SUV'],
    // «رنو 5» is a hatchback; the 5 in «سفران 2.5 لیتر» is not.
    ['رنو', 'رنو سفران 2.5 لیتر LE', null],
    // `\b` does not work against Persian letters — سول needs ( |$).
    ['کیا', 'کیا سول', 'HATCHBACK'],
    // brands whose whole showroom is one shape
    ['تانک', 'تانک 300 2.0 لیتر توربو', 'SUV'],
    ['فیدلیتی', 'فیدلیتی پرایم تیپ 1 پنج نفره', 'SUV'],
    ['اکستریم', 'اکستریم VX (QX) 2.0 لیتر توربو', 'PICKUP'],
    ['پادرا موتور', 'پادرا موتور تاگا H استاندارد', 'PICKUP'],
    ['پاژن', 'پاژن دو در', 'SUV'],
    ['پاژن', 'پاژن وانت تک کابین', 'PICKUP_SINGLE'],
    // the diacritic in «جِی ام سی» must not hide the brand
    ['جِی ام سی (JMC)', 'جِی ام سی (JMC) S350', 'SUV'],
    ['جی ام سی (GMC)', 'جی ام سی (GMC) یوکان', 'SUV'],
    ['جی ام سی (GMC)', 'جی ام سی (GMC) سیرا', 'PICKUP'],
    // models the first pass missed outright
    ['ولوو', 'ولوو XC90 T8', 'SUV'],
    ['ولوو', 'ولوو V40 R دیزاین', 'HATCHBACK'],
    ['ولوو', 'ولوو 940', null],
    ['پژو', 'پژو 2008', 'SUV'],
    ['پژو', 'پژو 308', 'HATCHBACK'],
    ['نیسان', 'نیسان ناوارا 2.5 لیتر ساده', 'PICKUP'],
    ['نیسان', 'نیسان ترا اکسکلوسیو', 'SUV'],
    ['نیسان', 'نیسان ترانو', 'SUV'],
    ['هیوندای', 'هیوندای آیونیک 5 2WD', 'SUV'],
    ['تویوتا', 'تویوتا C-HR هیبرید 1.8 لیتر', 'SUV'],
    ['تویوتا', 'تویوتا پریوس تیپ 2', 'HATCHBACK'],
    ['تویوتا', 'تویوتا bZ3 الیت پرو', null],
    ['تویوتا', 'تویوتا bZ3X 520 پرو', 'SUV'],
    ['بنز', 'بنز کلاس G G500', 'SUV'],
    ['بنز', 'بنز کلاس GLK GLK350', 'SUV'],
    ['بنز', 'بنز کلاس S S500', null],
    ['آئودی', 'آئودی Q4 e-tron 40', 'SUV'],
    ['آئودی', 'آئودی A3 اسپرت بک 1.5 لیتر توربو', 'HATCHBACK'],
    ['ام جی', 'ام جی 3', 'HATCHBACK'],
    ['ام جی', 'ام جی 350', null],
    ['ام جی', 'ام جی RX5', 'SUV'],
    ['ام وی ام', 'ام وی ام 110S لاکچری', 'HATCHBACK'],
    ['ام وی ام', 'ام وی ام X77 الیت', 'SUV'],
    ['اینفینیتی', 'اینفینیتی QX70', 'SUV'],
    ['اینفینیتی', 'اینفینیتی Q50', null],
    ['فولکس', 'فولکس ID.4 Crozz پرو', 'SUV'],
    ['فولکس', 'فولکس بیتل', 'HATCHBACK'],
    ['کیا', 'کیا EV5 تیپ 530', 'SUV'],
    ['کیا', 'کیا K5 2 لیتر', null],
    ['مینی', 'مینی کانتری من 2.0 لیتر توربو', 'SUV'],
    ['مینی', 'مینی کوپر 5 در', 'HATCHBACK'],
    ['دوو', 'دوو ماتیز', 'HATCHBACK'],
    ['لادا', 'لادا نیوا', 'SUV'],
    ['یوآز', 'یوآز پاتریوت اتوماتیک', 'SUV'],
    ['فوتون', 'فوتون ساوانا اتوماتیک', 'SUV'],
    ['فوتون', 'فوتون تونلند G7 بنزینی', 'PICKUP'],
    ['سوزوکی', 'سوزوکی جیمنی 3 در اتوماتیک', 'SUV'],
    ['سوزوکی', 'سوزوکی سوییفت 1.2 لیتر هیبرید', 'HATCHBACK'],
    ['ری را', 'ری را 1.7 لیتر توربو 6 سرعته اتوماتیک', 'SUV'],
    ['جی ای سی', 'جی ای سی امکو 1.5 لیتر توربو', 'SUV'],
    ['جی ای سی', 'جی ای سی امپو 1.5 لیتر توربو', null],
    ['کی ام سی', 'کی ام سی T9 2 لیتر توربو', 'PICKUP'],
    ['کی ام سی', 'کی ام سی eJ7 ساده', 'SUV'],
  ];

  it.each(cases)('%s %s → %s', (brand, model, expected) => {
    expect(classify(brand, model)).toBe(expected);
  });
});
