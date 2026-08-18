/* eslint-disable no-console */
//
// Console rather than the logger: a build tool a person runs by hand, whose
// output is read once.

const fs = require('fs');
const path = require('path');

const catalogData = require('../src/constants/carCatalog.data.json');

/**
 * Draws a tile for every brand that has no real logo.
 *
 *   node scripts/generate-brand-tiles.js
 *
 * ── Why draw them instead of collecting them ────────────────────────────────
 *
 * The market list has 186 brands and the site it came from publishes logos for
 * eight — its own featured row. The other 178 have none anywhere in that data.
 * Collecting the rest from around the web would mean 178 files in 178 sizes,
 * some on white, some transparent, some cropped tight and some floating in
 * space, several wrong, and a handful of obscure Iranian assemblers with no
 * findable mark at all. A row of those is worse to look at than no logos, and
 * "they must all follow one format" is precisely the requirement it fails.
 *
 * Drawing them makes that requirement true by construction: one geometry, one
 * type size, one palette, every brand covered, 300 bytes each, no network and
 * nothing to license. The eight real logos still win where they exist — a
 * genuine Peugeot mark beats a monogram, and this never overwrites one.
 *
 * ── The colour is derived, not assigned ─────────────────────────────────────
 *
 * From the slug, so it is stable: a brand keeps its colour across rebuilds,
 * and two brands never swap because somebody inserted a row above them. Which
 * matters more than it sounds — the colour is what the eye learns to find a
 * brand by in a list of 186.
 */

const OUT = path.join(__dirname, '..', '..', 'frontend', 'assets', 'brands');

/**
 * Twelve colours from the app's own palette family: deep, muted, and readable
 * with white type on top. Not twelve random hues — a row of primary colours
 * looks like a toy next to this product's paper-and-ink surfaces.
 */
const COLOURS = [
  '#0e5a51', '#a85a24', '#2c6b41', '#4a4a7c', '#8a5b2b', '#1f6b78',
  '#6b3f5e', '#3f6b3a', '#7a4a3a', '#2f5a7a', '#6b5f2b', '#5a3f6b',
];

/** A small stable hash. Not cryptographic — it only has to be repeatable. */
function hash(text) {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) {
    h = (h * 31 + text.charCodeAt(i)) >>> 0;
  }
  return h;
}

/**
 * The two letters shown on the tile.
 *
 * Persian letters join, so two adjacent characters read as one short word
 * rather than as two initials — «پژ» for پژو, «ام» for ام وی ام. Spaces are
 * dropped first, because «ب ام و» would otherwise render as a letter, a gap,
 * and nothing.
 */
function monogram(name) {
  const letters = [...name.replace(/[\s()]/g, '')];
  return letters.slice(0, 2).join('') || '?';
}

/**
 * The tile.
 *
 * A rounded square, because that is the shape of every other small badge in
 * this product. `text-anchor` and `dominant-baseline` do the centring rather
 * than hand-computed offsets, so the glyph stays centred whatever font the
 * viewer has — and `font-family` names the app's own face first with a real
 * fallback stack, since an SVG rendered inside an <img> cannot inherit the
 * page's font.
 */
function tile(name, colour) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="40" height="40" role="img" aria-label="${name.replace(/[<>&"]/g, '')}">
  <rect width="40" height="40" rx="9" fill="${colour}"/>
  <text x="20" y="21" text-anchor="middle" dominant-baseline="central"
        font-family="Vazirmatn, Tahoma, sans-serif" font-size="15" font-weight="700"
        fill="#ffffff">${monogram(name).replace(/[<>&"]/g, '')}</text>
</svg>
`;
}

/** Extensions a real logo could arrive with — any of them means "leave alone". */
const REAL = ['.png', '.svg', '.webp', '.jpg'];

function main() {
  fs.mkdirSync(OUT, { recursive: true });

  let drawn = 0;
  let kept = 0;

  for (const brand of catalogData.brands) {
    // A real logo, in any format, wins. Checked before writing rather than
    // after, so re-running this can never replace one with a monogram.
    const existing = REAL.map((ext) => path.join(OUT, brand.slug + ext)).find((p) =>
      fs.existsSync(p)
    );
    if (existing) {
      kept += 1;
      continue;
    }

    const colour = COLOURS[hash(brand.slug) % COLOURS.length];
    fs.writeFileSync(path.join(OUT, `${brand.slug}.svg`), tile(brand.name, colour), 'utf8');
    drawn += 1;
  }

  console.log(`✓ ${drawn} کاشی ساخته شد · ${kept} لوگوی واقعی دست‌نخورده ماند`);
  console.log(`  ${path.relative(process.cwd(), OUT)}`);
  console.log('  حالا build-catalog.js را دوباره بزنید تا فایل کاتالوگ این‌ها را ببیند.');
}

main();
