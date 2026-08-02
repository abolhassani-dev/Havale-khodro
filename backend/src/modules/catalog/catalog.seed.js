const { prisma } = require('../../config/database');
const { COMPANIES, COLORS } = require('../../constants/carCatalog');
const logger = require('../../utils/logger');

/**
 * Loads the starting catalogue.
 *
 * Idempotent and additive: it creates what is missing and leaves everything else
 * alone. That matters because the admin panel owns this data from the moment the
 * system is live — a seeder that overwrote on every deploy would silently undo
 * the operator's corrections, and that is a maddening bug to chase.
 */
async function seedCatalog() {
  let brands = 0;
  let models = 0;

  for (const [companyIndex, companyData] of COMPANIES.entries()) {
    const company = await prisma.carCompany.upsert({
      where: { slug: companyData.slug },
      update: {},
      create: {
        name: companyData.name,
        slug: companyData.slug,
        sortOrder: companyData.sortOrder ?? companyIndex,
      },
    });

    for (const [brandIndex, brandData] of companyData.brands.entries()) {
      const brand = await prisma.carBrand.upsert({
        where: { companyId_name: { companyId: company.id, name: brandData.name } },
        update: {},
        create: {
          companyId: company.id,
          name: brandData.name,
          slug: brandData.slug,
          sortOrder: brandData.sortOrder ?? brandIndex,
        },
      });
      brands += 1;

      for (const [modelIndex, name] of brandData.models.entries()) {
        await prisma.carModel.upsert({
          where: { brandId_name: { brandId: brand.id, name } },
          update: {},
          create: { brandId: brand.id, name, sortOrder: modelIndex },
        });
        models += 1;
      }
    }
  }

  for (const [index, name] of COLORS.entries()) {
    await prisma.carColor.upsert({
      where: { name },
      update: {},
      create: { name, sortOrder: index },
    });
  }

  logger.info('Catalog ready', { brands, models, colors: COLORS.length });
}

module.exports = { seedCatalog };
