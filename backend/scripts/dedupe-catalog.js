/* eslint-disable no-console */
//
// Console rather than the logger: a one-off tool a person runs and reads.
require('dotenv').config();

const { prisma, connectDatabase, disconnectDatabase } = require('../src/config/database');

/**
 * Retires the starter-catalogue models that the market list made redundant.
 *
 *   node scripts/dedupe-catalog.js            # what would change
 *   node scripts/dedupe-catalog.js --apply    # change it
 *
 * The first catalogue had 26 hand-written models under ام‌وی‌ام, فونیکس and
 * اکستریم. The imported market list covers the same cars, usually more
 * precisely (trims split out), so under those brands each car now appears
 * twice under two spellings — and a picker with two names for one car breaks
 * the very filtering the catalogue exists for.
 *
 * Deactivated, never deleted: the old rows are referenced by the demo
 * listings, and the rule everywhere in this catalogue is that retiring stops
 * new listings while old ones stay readable.
 *
 * ── The list is written out, not computed ───────────────────────────────────
 *
 * Every entry below was matched by hand against the imported list, and only
 * the certain ones are here. Three old models are deliberately absent because
 * no imported trim carries their marker, and "probably the same car" is not
 * the bar for making a model unpostable:
 *
 *   فونیکس Z8 GI            — the import has Z8 اکسلنت and Z8 PHEV, no GI
 *   فونیکس F7 پرو پریمیوم    — تیگو 7 «پرو» و «پرو مکس (F7)» دو خودروی
 *                              متفاوت‌اند و این نام نمی‌گوید کدام است
 *   فونیکس F8 پرو مکس AWD   — the import's F8 trims are اکسلنت و IE, no AWD
 *
 * A fuzzy matcher would have retired all three, silently, and been wrong at
 * least once.
 */

/** brand slug → the old names that the imported list demonstrably covers. */
const RETIRE = {
  mvm: [
    'ام‌وی‌ام X22 پرو دنده‌ای', //   → X22 PRO دنده ای
    'ام‌وی‌ام X22 پرو اتوماتیک', //  → X22 PRO اتوماتیک (اکسلنت / IE)
    'ام‌وی‌ام X33 کراس دنده‌ای', //  → X33 کراس دنده ای
    'ام‌وی‌ام X33 کراس اتوماتیک', // → X33 کراس اتوماتیک
    'ام‌وی‌ام X55 پرو', //           → X55 PRO (اکسلنت / پریمیوم / …)
    'ام‌وی‌ام X55 پرو IE', //        → X55 PRO IE
    'ام‌وی‌ام X77', //               → X77 الیت (تک‌تریم)
  ],
  fownix: [
    'فونیکس FX', //                → FX اکسلنت
    'فونیکس FX پریمیوم', //         → FX پریمیوم AWD / FWD
    'فونیکس FX EV', //             → FX EV 150 کیلو وات
    'فونیکس Z6 GT', //             → آریزو 6 جی تی (Z6 GT) اکسلنت
    'فونیکس Z8', //                → آریزو 8 (Z8) اکسلنت
    'فونیکس F7', //                → تیگو 7 پرو مکس (F7) …
    'فونیکس F7 پرو مکس', //         → تیگو 7 پرو مکس (F7) …
    'فونیکس F7 پرو e هیبرید', //    → تیگو 7 پرو هیبرید (F7) e پلاس
    'فونیکس F8', //                → تیگو 8 پرو مکس (F8) …
    'فونیکس F8 پرو مکس', //         → تیگو 8 پرو مکس (F8) اکسلنت
    'فونیکس F8 پرو مکس IE', //      → تیگو 8 پرو مکس (F8) IE
    'فونیکس F8 پرو e هیبرید', //    → تیگو 8 پرو هیبرید (F8) e پلاس
    'فونیکس F9', //                → F9 2.0 لیتر توربو
  ],
  xtrim: [
    'اکستریم LX', //  → LX (SX) 1.6 لیتر توربو
    'اکستریم TXL', // → TXL (TX) 2.0 لیتر توربو
    'اکستریم VX', //  → VX (QX) 2.0 لیتر توربو
  ],
};

const KEPT = ['فونیکس Z8 GI', 'فونیکس F7 پرو پریمیوم', 'فونیکس F8 پرو مکس AWD'];

async function main() {
  const apply = process.argv.includes('--apply');
  await connectDatabase();

  let retired = 0;
  let missing = 0;

  for (const [slug, names] of Object.entries(RETIRE)) {
    const brand = await prisma.carBrand.findUnique({ where: { slug }, select: { id: true } });
    if (!brand) {
      console.log(`− برند ${slug} در این دیتابیس نیست`);
      continue;
    }

    for (const name of names) {
      const model = await prisma.carModel.findFirst({
        where: { brandId: brand.id, name, isActive: true },
        select: { id: true, name: true },
      });
      if (!model) {
        missing += 1;
        continue; // Already retired, or never seeded here. Both are fine.
      }

      const listings = await prisma.havale.count({ where: { carModelId: model.id } });
      if (apply) {
        await prisma.carModel.update({ where: { id: model.id }, data: { isActive: false } });
      }
      retired += 1;
      console.log(
        `${apply ? '✓ بازنشسته شد' : '· بازنشسته می‌شود'}: ${model.name}` +
          (listings ? `   (${listings} آگهی قدیمی دست‌نخورده می‌ماند)` : '')
      );
    }
  }

  console.log(`\n${apply ? 'انجام شد' : 'پیش‌نمایش'}: ${retired} مدل · ${missing} مورد از قبل نبود/بازنشسته بود`);
  console.log('عمداً دست‌نخورده (معادل قطعی در فهرست جدید ندارند):');
  for (const name of KEPT) console.log('  ·', name);
  if (!apply) console.log('\nبرای اعمال:  node scripts/dedupe-catalog.js --apply');
}

main()
  .catch((err) => {
    console.error('✗', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDatabase().catch(() => {});
  });
