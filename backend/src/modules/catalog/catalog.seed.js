const { prisma } = require('../../config/database');
const { COLORS } = require('../../constants/carCatalog');
const catalogData = require('../../constants/carCatalog.data.json');
const logger = require('../../utils/logger');

/**
 * Loads the starting catalogue.
 *
 * Idempotent and additive: it creates what is missing and leaves everything
 * else alone. That matters because the admin panel owns this data from the
 * moment the system is live — a seeder that overwrote on every deploy would
 * silently undo the operator's corrections, and that is a maddening bug to
 * chase.
 *
 * Additive has one consequence worth stating: a brand or model removed from the
 * data file is not removed from the database. Retiring one is a decision, made
 * in the panel by setting it inactive, so that the listings pointing at it keep
 * working. `scripts/import-catalog.js --replace` is the blunt instrument for
 * before launch, and it says so.
 *
 * Brands arrive with no company. Bama, where the list comes from, has no such
 * level — پژو, سمند, دنا, رانا and تارا are five separate brands with no
 * ایران خودرو above them — and guessing which company makes what would file
 * brands under manufacturers that do not build them. Grouping is done in the
 * panel, by somebody who knows.
 */
async function seedCatalog() {
  let brands = 0;
  let models = 0;

  for (const brandData of catalogData.brands) {
    const brand = await prisma.carBrand.upsert({
      where: { slug: brandData.slug },
      // The logo is the one field worth refreshing: it is a file name derived
      // from the slug, never edited by hand, and a brand that gained one since
      // the last run should show it. Name, company and sort order are left
      // alone because those are the operator's to change.
      update: { logo: brandData.logo },
      create: {
        name: brandData.name,
        slug: brandData.slug,
        logo: brandData.logo,
        sortOrder: brandData.sortOrder ?? 0,
      },
    });
    brands += 1;

    // One statement rather than a query per model: 2044 upserts in a loop is
    // two thousand round trips, and this runs on a 3-core server.
    const created = await prisma.carModel.createMany({
      data: brandData.models.map((name, index) => ({
        brandId: brand.id,
        name,
        sortOrder: index,
      })),
      // Which is what makes this re-runnable: the (brandId, name) unique key
      // rejects the ones already there and the rest go in.
      skipDuplicates: true,
    });
    models += created.count;
  }

  for (const [index, name] of COLORS.entries()) {
    await prisma.carColor.upsert({
      where: { name },
      update: {},
      create: { name, sortOrder: index },
    });
  }

  logger.info('Catalog ready', { brands, newModels: models, colors: COLORS.length });
}

module.exports = { seedCatalog };
