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

    // pickups
    ['تویوتا', 'تویوتا هایلوکس دو کابین بلند', 'PICKUP'],
    ['زامیاد', 'زامیاد Z24 بنزینی', 'PICKUP'],
    ['پراید', 'پراید 151 پلاس', 'PICKUP'],
    ['رنو', 'رنو تندر 90 وانت', 'PICKUP'],
    ['آریسان', 'آریسان 2', 'PICKUP'],
    ['ایسوزو', 'ایسوزو دی مکس دو کابین', 'PICKUP'],

    // an import nobody wrote a rule for stays unclassified, not guessed
    ['مازراتی', 'مازراتی گرن توریسمو', null],
  ];

  it.each(cases)('%s %s → %s', (brand, model, expected) => {
    expect(classify(brand, model)).toBe(expected);
  });
});
