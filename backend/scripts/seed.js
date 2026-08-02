require('dotenv').config();

const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const config = require('../src/config');
const { prisma, connectDatabase, disconnectDatabase } = require('../src/config/database');
const logger = require('../src/utils/logger');
const { ROLES } = require('../src/constants/roles');
const { seedCatalog } = require('../src/modules/catalog/catalog.seed');

/**
 * First-run data.
 *
 * The system has no public registration by design, so without this script there
 * is no way in at all: the very first administrator has to be created out of
 * band. Everything here is idempotent — running it twice must be safe, because
 * it will be run twice.
 */

const ADMIN_USERNAME = process.env.SEED_ADMIN_USERNAME || 'admin';
const ADMIN_PHONE = process.env.SEED_ADMIN_PHONE || '09120000000';

/**
 * Never bake a password into the repository.
 *
 * In production the password must be supplied deliberately. In development a
 * random one is generated and printed once — printing it is acceptable there and
 * would not be in production, which is why the two paths differ.
 */
function resolveAdminPassword() {
  if (process.env.SEED_ADMIN_PASSWORD) return { password: process.env.SEED_ADMIN_PASSWORD };

  if (config.isProduction) {
    throw new Error('SEED_ADMIN_PASSWORD is required when NODE_ENV=production');
  }

  return { password: crypto.randomBytes(12).toString('base64url'), generated: true };
}

async function seedAdmin() {
  const existing = await prisma.user.findFirst({ where: { role: ROLES.SUPER_ADMIN } });
  if (existing) {
    logger.info('Super admin already exists, leaving it alone', { username: existing.username });
    return;
  }

  const { password, generated } = resolveAdminPassword();

  await prisma.user.create({
    data: {
      username: ADMIN_USERNAME,
      passwordHash: await bcrypt.hash(password, config.security.bcryptRounds),
      phone: ADMIN_PHONE,
      fullName: 'مدیر سامانه',
      role: ROLES.SUPER_ADMIN,
      // The password above was chosen by whoever ran this script, so it is known
      // to someone other than the account holder. It has to be replaced on the
      // first sign-in.
      mustChangePassword: true,
    },
  });

  logger.info('Super admin created', { username: ADMIN_USERNAME });
  if (generated) {
    // eslint-disable-next-line no-console
    console.log(`\n  username: ${ADMIN_USERNAME}\n  password: ${password}\n`);
  }
}

/** The single subscription plan of phase one (blueprint 4.1). */
async function seedPlans() {
  await prisma.plan.upsert({
    where: { name: 'ماهانه' },
    update: {},
    create: {
      name: 'ماهانه',
      durationDays: 30,
      priceToman: 25_000_000n,
      dailyRevealLimit: 30,
      monthlyRevealLimit: 300,
      maxActiveHavale: 0,
    },
  });
  logger.info('Plans ready');
}

async function seed() {
  await connectDatabase();
  await seedAdmin();
  await seedPlans();
  await seedCatalog();
  await disconnectDatabase();
}

seed().catch(async (err) => {
  logger.error('Seed failed', { error: err.message });
  await disconnectDatabase().catch(() => {});
  process.exit(1);
});
