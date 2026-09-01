require('dotenv').config();

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const config = require('../src/config');
const { prisma, connectDatabase, disconnectDatabase } = require('../src/config/database');
const logger = require('../src/utils/logger');
const carService = require('../src/modules/car/car.service');
const { UPLOADS_DIR } = require('../src/modules/car/car.upload');
const { currentJalaliYear } = require('../src/modules/car/car.constants');

/**
 * Sample advertisements for the خودرو market.
 *
 * Runs after `npm run seed:demo`: the demo agencies post the cars, so the
 * same four accounts a reviewer already signs in with own them. Every row
 * goes through carService — the same path the form takes — so the body grade
 * is derived, the year is checked against the calendar and the activity log
 * fills in exactly as it would for a real posting. Writing straight to the
 * table would let this fixture drift from the rules it is meant to show off.
 *
 * The mix is deliberate: all four body shapes, a صفرکیلومتر next to a
 * شاسی‌خورده, a couple of requests, two sale advertisements with photos and
 * the rest without — so the search page, the filters, the body map and the
 * photo gate all have something to show.
 *
 * Idempotent per sample: a sample whose owner already has a live
 * advertisement of the same kind for the same car is skipped, so running it
 * twice does not double the market — and a smoke run that posted one car of
 * its own does not stop the rest from appearing.
 */

const DEMO_USERS = ['alborz', 'pars', 'zagros', 'khalij'];

// `match` picks a catalogue row by name; `body` narrows it to the shape the
// sample is written for, so the body map on the card shows the right cut-out
// even if the catalogue is renamed and the name match falls through to a
// sibling.
const SAMPLES = [
  {
    match: 'دنا پلاس EF7 اتوماتیک توربو',
    body: 'SEDAN',
    kind: 'OFFER',
    yearsAgo: 2,
    mileageKm: 38_000,
    carColor: 'سفید',
    warranty: true,
    carPriceToman: 1_180_000_000,
    bodyStatus: {},
    description: 'یک دست، بیمه تا آخر سال، معاینه فنی دارد.',
    photos: 3,
  },
  {
    match: 'شاهین اتوماتیک CVT تیپ GL',
    body: 'SEDAN',
    kind: 'OFFER',
    yearsAgo: 0,
    mileageKm: 0,
    carColor: 'مشکی',
    warranty: true,
    carPriceToman: 1_350_000_000,
    bodyStatus: {},
    description: 'صفرکیلومتر، تحویل فوری از نمایندگی.',
    photos: 0,
  },
  {
    match: 'پژو 206 SD V',
    body: 'SEDAN',
    kind: 'OFFER',
    yearsAgo: 9,
    mileageKm: 176_000,
    carColor: 'نقره‌ای',
    warranty: false,
    carPriceToman: 520_000_000,
    bodyStatus: { 'dr-f-p': 'PAINT', 'fnd-f-p': 'PARTIAL' },
    description: 'دو لکه رنگ سمت شاگرد، فنی سالم.',
    photos: 2,
  },
  {
    match: 'تیبا هاچ بک پلاس',
    body: 'HATCHBACK',
    kind: 'OFFER',
    yearsAgo: 5,
    mileageKm: 92_000,
    carColor: 'خاکستری',
    warranty: false,
    carPriceToman: 430_000_000,
    bodyStatus: { hood: 'REPLACE', 'chs-f-d': 'SPRAY' },
    description: null,
    photos: 0,
  },
  {
    match: 'فونیکس تیگو 8 پرو',
    body: 'SUV',
    kind: 'OFFER',
    yearsAgo: 1,
    mileageKm: 21_500,
    carColor: 'سفید',
    warranty: true,
    carPriceToman: 3_900_000_000,
    bodyStatus: {},
    description: 'کم‌کار، سرویس‌های دوره‌ای در نمایندگی.',
    photos: 4,
  },
  {
    match: 'هایما S7 1.8 لیتر توربو',
    body: 'SUV',
    kind: 'OFFER',
    yearsAgo: 4,
    mileageKm: 68_000,
    carColor: 'مشکی',
    warranty: false,
    carPriceToman: 1_950_000_000,
    bodyStatus: { 'chs-f-p': 'DAMAGE', 'fnd-f-p': 'REPLACE', hood: 'PAINT' },
    description: 'تصادف جلو، شاسی جلو شاگرد آسیب دیده — قیمت متناسب.',
    photos: 0,
  },
  {
    match: 'نیسان پیکاپ دو کابین',
    body: 'PICKUP',
    kind: 'OFFER',
    yearsAgo: 3,
    mileageKm: 54_000,
    carColor: 'سفید',
    warranty: false,
    carPriceToman: 2_100_000_000,
    bodyStatus: { trunk: 'PARTIAL' },
    description: 'مناسب کار، لاستیک نو.',
    photos: 0,
  },
  {
    match: 'سوزوکی گراند ویتارا (مونتاژ) 2.4 لیتر اتوماتیک',
    body: 'SUV',
    kind: 'REQUEST',
    yearsFromAgo: 12,
    yearsToAgo: 6,
    maxMileageKm: 150_000,
    priceFromToman: 1_200_000_000,
    carPriceToman: 1_700_000_000,
    paintTolerance: 'MINOR_OK',
    description: 'برای مشتری حضوری، رنگ روشن ترجیحاً.',
  },
  {
    match: 'جک S5 2.0 لیتر اتوماتیک',
    body: 'SUV',
    kind: 'REQUEST',
    yearsFromAgo: 6,
    yearsToAgo: 2,
    maxMileageKm: 80_000,
    priceFromToman: null,
    carPriceToman: 1_500_000_000,
    paintTolerance: 'NO_PAINT_ONLY',
    description: null,
  },
  {
    match: 'سمند سورن پلاس',
    body: 'SEDAN',
    kind: 'REQUEST',
    yearsFromAgo: 3,
    yearsToAgo: 0,
    maxMileageKm: null,
    priceFromToman: null,
    carPriceToman: null,
    paintTolerance: 'ANY',
    description: 'چند دستگاه برای ناوگان — تعداد مهم است نه رنگ.',
  },
];

/**
 * A small PNG with a solid colour and a lighter band across it — enough to
 * tell one photo from the next on screen, without shipping binary fixtures
 * in the repository.
 */
function placeholderPng(width, height, [r, g, b]) {
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const band = y > height * 0.55 && y < height * 0.75;
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x += 1) {
      const k = band ? 1.35 : 1;
      row[1 + x * 3] = Math.min(255, Math.round(r * k));
      row[2 + x * 3] = Math.min(255, Math.round(g * k));
      row[3 + x * 3] = Math.min(255, Math.round(b * k));
    }
    rows.push(row);
  }

  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const PHOTO_TINTS = [
  [72, 96, 128],
  [120, 120, 120],
  [160, 60, 60],
  [60, 130, 90],
];

/** Writes the placeholders the way the uploader would, then attaches them. */
async function attachPhotos(user, listingId, count) {
  const files = [];
  for (let i = 0; i < count; i += 1) {
    const filename = `${crypto.randomUUID()}.png`;
    const bytes = placeholderPng(640, 420, PHOTO_TINTS[i % PHOTO_TINTS.length]);
    fs.writeFileSync(path.join(UPLOADS_DIR, filename), bytes);
    files.push({ filename, mimetype: 'image/png', size: bytes.length });
  }
  await carService.addPhotos({ user, id: listingId, files });
}

async function pickModel(sample) {
  const byName = await prisma.carModel.findFirst({
    where: { isActive: true, name: { contains: sample.match } },
    orderBy: { name: 'asc' },
  });
  if (byName) return byName;
  // The catalogue was rebuilt and the name is gone: any active model of the
  // same shape keeps the sample meaningful.
  return prisma.carModel.findFirst({
    where: { isActive: true, bodyType: sample.body },
    orderBy: { name: 'asc' },
  });
}

function payloadFor(sample, model, year) {
  if (sample.kind === 'OFFER') {
    return {
      kind: 'OFFER',
      carModelId: model.id,
      year: year - sample.yearsAgo,
      mileageKm: sample.mileageKm,
      carColor: sample.carColor,
      warranty: sample.warranty,
      carPriceToman: sample.carPriceToman,
      bodyStatus: sample.bodyStatus,
      description: sample.description,
    };
  }
  return {
    kind: 'REQUEST',
    carModelId: model.id,
    yearFrom: year - sample.yearsFromAgo,
    yearTo: year - sample.yearsToAgo,
    maxMileageKm: sample.maxMileageKm,
    priceFromToman: sample.priceFromToman,
    carPriceToman: sample.carPriceToman,
    paintTolerance: sample.paintTolerance,
    description: sample.description,
  };
}

/**
 * Clears duplicates an earlier version of this script left behind.
 *
 * That version dealt the samples out in whatever order the database
 * returned the demo agencies, then asked «does THIS agency already have
 * this car?» — so a second run handed the same car to a different agency
 * and the market showed the same نیسان پیکاپ twice. The check is now
 * owner-agnostic, but the rows are already out there.
 *
 * Withdrawn rather than erased (`deletedAt`, exactly what «برداشتن» in the
 * admin panel does), and only ever among the demo agencies' own cars: the
 * oldest of each duplicate group stays, its reveals and reports intact.
 */
async function dedupe(owners, keys) {
  const rows = await prisma.listing.findMany({
    where: { market: 'CAR', deletedAt: null, ownerId: { in: owners.map((o) => o.id) } },
    select: { id: true, kind: true, carModelId: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  const seen = new Set();
  const extra = [];
  for (const row of rows) {
    const key = `${row.kind}:${row.carModelId}`;
    // Only the cars this script posts. A demo agency that really did post
    // two of the same model by hand keeps both.
    if (!keys.has(key)) continue;
    if (seen.has(key)) extra.push(row.id);
    else seen.add(key);
  }
  if (!extra.length) return 0;

  await prisma.listing.updateMany({ where: { id: { in: extra } }, data: { deletedAt: new Date() } });
  logger.warn('Withdrew duplicate sample advertisements from an earlier run', { count: extra.length });
  return extra.length;
}

async function seedCars() {
  if (config.isProduction && process.env.ALLOW_DEMO_SEED !== 'true') {
    throw new Error(
      'Refusing to post sample advertisements while NODE_ENV=production — they belong to the demo accounts. ' +
        'On a staging box nobody real uses yet, add ALLOW_DEMO_SEED=true to .env and run again.'
    );
  }

  await connectDatabase();

  const found = await prisma.user.findMany({ where: { username: { in: DEMO_USERS } } });
  // In the order written above, not the database's: sample N belongs to
  // owner N % 4, and the «already there» check looks for that owner — a
  // different order on the next run would post every sample a second time.
  const owners = DEMO_USERS.map((name) => found.find((u) => u.username === name)).filter(Boolean);
  if (!owners.length) throw new Error('Run `npm run seed:demo` first — there are no demo agencies to post as.');

  const year = currentJalaliYear();
  const keys = new Set();
  let posted = 0;
  let skipped = 0;
  let photos = 0;
  for (const [index, sample] of SAMPLES.entries()) {
    const model = await pickModel(sample);
    if (!model) {
      logger.warn('No catalogue model for a sample — skipped', { match: sample.match });
      continue;
    }
    const user = owners[index % owners.length];

    // «Already there» is judged across all four demo owners, not the one
    // this run would pick: an earlier run may have dealt the samples out in
    // a different order, and a check tied to the owner would post them all
    // a second time.
    const demoOwners = { in: owners.map((o) => o.id) };
    keys.add(`${sample.kind}:${model.id}`);
    const already = await prisma.listing.count({
      where: { market: 'CAR', deletedAt: null, ownerId: demoOwners, kind: sample.kind, carModelId: model.id },
    });
    if (already) {
      // A sample posted before the warranty field existed says «نامشخص»
      // on screen; the seed knows the answer, so it fills it in once.
      if (sample.kind === 'OFFER' && sample.warranty !== undefined) {
        await prisma.carDetail.updateMany({
          where: { warranty: null, listing: { ownerId: demoOwners, kind: 'OFFER', carModelId: model.id, deletedAt: null } },
          data: { warranty: sample.warranty },
        });
      }
      skipped += 1;
      continue;
    }
    const row = await carService.create({ user, payload: payloadFor(sample, model, year) });
    posted += 1;

    if (sample.kind === 'OFFER' && sample.photos) {
      await attachPhotos(user, row.id, sample.photos);
      photos += sample.photos;
    }
  }

  // After the loop, so it knows exactly which cars are this script's own.
  const removed = await dedupe(owners, keys);

  logger.info('Sample خودرو advertisements ready', { posted, skipped, removed, photos });
  // eslint-disable-next-line no-console
  console.log(
    `\n  posted ${posted} خودرو advertisements (${photos} placeholder photos)` +
      (skipped ? `, ${skipped} already there` : '') +
      (removed ? `, ${removed} duplicates from earlier runs withdrawn` : '') +
      '\n'
  );

  await disconnectDatabase();
}

seedCars().catch(async (err) => {
  logger.error('Car seed failed', { error: err.message });
  await disconnectDatabase().catch(() => {});
  process.exit(1);
});
