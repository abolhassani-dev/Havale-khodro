/* eslint-disable no-console */
//
// Console rather than the logger: this is a build tool a person runs by hand,
// and its output is meant to be read once and then forgotten.

const fs = require('fs');
const path = require('path');

/**
 * Turns Bama's vehicle filter list into this project's catalogue file.
 *
 *   node scripts/build-catalog.js ~/vehicle.json
 *
 * Run by hand, rarely — when the market list is refreshed. What it writes is
 * committed, so a fresh install and a restore both get the catalogue without
 * needing to reach bama.ir. That matters: the source is only reachable from
 * inside Iran, so a build step that fetched it live would work on the server
 * and nowhere else.
 *
 * ── The shape it reads ───────────────────────────────────────────────────────
 *
 *   brand ──▶ model ──▶ trim
 *   پژو       پژو ۲۰۷    (none)
 *   آئودی     A3 اسپرت بک  ۱.۵ لیتر توربو
 *
 * Each level's `items` opens with a "همه‌ی مدل‌های X" entry marked
 * `select_all` — a UI affordance, not a car. Those are dropped.
 *
 * ── The shape it writes ──────────────────────────────────────────────────────
 *
 * Two levels: brand and model. Trims are folded into the model, because a trim
 * title is already the full name — «آئودی A3 اسپرت بک ۱.۵ لیتر توربو» — and
 * because a transfer is issued for a specific trim, not for a model family.
 * The catalogue this replaces already worked that way: «ام‌وی‌ام X22 پرو
 * اتوماتیک» is one entry, not a model plus a trim.
 *
 * ── What it deliberately does not write ─────────────────────────────────────
 *
 * The manufacturer. Bama has no such level — پژو, سمند, دنا, رانا and تارا are
 * five separate brands there, with no ایران خودرو above them — and inventing
 * one from guesswork would file brands under companies that do not make them.
 * So every brand arrives with no company, and grouping is something a person
 * does in the panel when they actually know. An ungrouped brand is fully
 * usable; it simply sits under «دسته‌بندی‌نشده».
 */

const SOURCE = 'https://bama.ir/gen/api/filters/vehicle?vehicleCategory=car';
const OUT = path.join(__dirname, '..', 'src', 'constants', 'carCatalog.data.json');
const LOGOS = path.join(__dirname, '..', '..', 'frontend', 'assets', 'brands');

/**
 * Which brands have a logo, decided by looking rather than by the source.
 *
 * The source claims all 186 do. Eight actually exist — the featured brands on
 * the site's own filter — and the address it gives for the rest answers
 * AccessDenied. Trusting the claim wrote a file name for every brand, and the
 * panel then asked for 178 images that are not there: 178 failed requests on
 * every visit, and a broken-image mark beside most of the list.
 *
 * So the file on disk is the authority. Fetch the logos, rebuild, and the two
 * agree by construction.
 */
function haveLogo() {
  const found = new Map();
  let files;
  try {
    files = fs.readdirSync(LOGOS);
  } catch {
    // The directory is absent before anybody has run the fetcher, which is a
    // normal state and not an error: it means no brand has a logo yet.
    return found;
  }

  // The real filename, not a guessed one. A real logo arrives as .png and a
  // drawn tile as .svg, so writing `${slug}.png` for both pointed half the
  // catalogue at files that are not there.
  //
  // Ordered so a real logo beats a drawn one when a brand has both: whoever
  // fetched a genuine mark meant it to be used.
  for (const ext of ['.png', '.webp', '.jpg', '.svg']) {
    for (const file of files) {
      if (!file.endsWith(ext)) continue;
      const slug = file.slice(0, -ext.length);
      if (!found.has(slug)) found.set(slug, file);
    }
  }
  return found;
}

/** The real children of a node: everything except the "all of X" shortcut. */
const realItems = (node) => (node.items || []).filter((item) => !item.select_all);

/**
 * Every model name a brand offers, trims included.
 *
 * A model with trims contributes its trims and not itself: offering both
 * «فونیکس تیگو ۸ پرو» and «فونیکس تیگو ۸ پرو مکس» is useful, but offering the
 * family alongside its own members gives two ways to describe one car and the
 * filter stops working — which is the entire reason this is a table and not a
 * text box.
 */
function modelsOf(brand) {
  const names = [];

  for (const model of realItems(brand)) {
    const trims = realItems(model);
    if (trims.length) names.push(...trims.map((t) => t.title));
    else names.push(model.title);
  }

  // Same name twice would break the (brandId, name) unique key on import, and
  // would be indistinguishable to whoever picked it from the list anyway.
  return [...new Set(names.map((n) => n.replace(/\s+/g, ' ').trim()))].filter(Boolean);
}

function main() {
  const input = process.argv[2];
  if (!input) {
    console.error('usage: node scripts/build-catalog.js <vehicle.json>');
    console.error(`  the file is what ${SOURCE} returns`);
    process.exitCode = 1;
    return;
  }

  const raw = JSON.parse(fs.readFileSync(input, 'utf8'));
  const source = Array.isArray(raw) ? raw : raw.data;
  if (!Array.isArray(source)) {
    console.error('✗ unexpected shape: expected an array, or an object with a `data` array.');
    process.exitCode = 1;
    return;
  }

  const logos = haveLogo();

  const brands = source
    .filter((b) => b.type === 'brand' && b.title && b.value)
    .map((b, index) => ({
      name: b.title.replace(/\s+/g, ' ').trim(),
      slug: b.value,
      // Only the file name, and only when the file is there. The logo is served
      // from this project, so the remote address is of no use past the one-off
      // download — and the source's claim that every brand has one is wrong.
      logo: logos.get(b.value) || null,
      sortOrder: index,
      models: modelsOf(b),
    }))
    .filter((b) => b.models.length);

  const totals = brands.reduce((n, b) => n + b.models.length, 0);
  const withLogo = brands.filter((b) => b.logo).length;

  fs.writeFileSync(
    OUT,
    `${JSON.stringify({ source, brands }, null, 0).slice(0, 0)}${JSON.stringify(
      {
        source: SOURCE,
        note: 'ساخته‌شده با scripts/build-catalog.js — دستی ویرایش نکنید. دسته‌بندی شرکت‌ها در پنل مدیریت انجام می‌شود.',
        brands,
      },
      null,
      2
    )}\n`,
    'utf8'
  );

  console.log(`✓ ${brands.length} برند · ${totals} مدل · ${withLogo} لوگو`);
  console.log(`  ${path.relative(process.cwd(), OUT)}`);

  const dropped = source.length - brands.length;
  if (dropped) console.log(`  ${dropped} برند بدون مدل کنار گذاشته شد`);

  if (!withLogo) {
    console.log('  لوگویی پیدا نشد — اول ./deploy/fetch-brand-logos.sh را اجرا کنید،');
    console.log('  بعد دوباره این را بزنید تا فایل کاتالوگ با آنچه روی دیسک هست بخواند.');
  }
}

main();
