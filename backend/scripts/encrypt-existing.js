/**
 * Converts contact columns written before encryption existed.
 *
 * Runs on every start and does nothing when there is nothing to do, so it can
 * live in the entrypoint rather than in somebody's memory. A migration that
 * has to be remembered is a migration that gets skipped on the one server that
 * mattered.
 *
 * Deliberately uses a raw client with no middleware: the middleware would
 * encrypt on write and decrypt on read, which is precisely what has to be
 * bypassed to see which rows are still plaintext.
 *
 *   node scripts/encrypt-existing.js
 */
const { PrismaClient } = require('@prisma/client');
const { encrypt, isEncrypted, blindIndex } = require('../src/utils/crypto');
const logger = require('../src/utils/logger');

const raw = new PrismaClient();

async function run() {
  let users = 0;
  let reveals = 0;

  const rows = await raw.user.findMany({
    select: { id: true, phone: true, coordinatorPhone: true, phoneIndex: true },
  });

  for (const row of rows) {
    const data = {};

    if (row.phone && !isEncrypted(row.phone)) {
      data.phoneIndex = blindIndex(row.phone);
      data.phone = encrypt(row.phone);
    } else if (row.phone && !row.phoneIndex) {
      // Encrypted but unindexed: possible if a write slipped through before the
      // index existed. Without the index the account cannot be found by phone.
      logger.warn('A user has an encrypted phone but no index — cannot rebuild it', {
        userId: row.id,
      });
    }

    if (row.coordinatorPhone && !isEncrypted(row.coordinatorPhone)) {
      data.coordinatorPhone = encrypt(row.coordinatorPhone);
    }

    if (Object.keys(data).length) {
      await raw.user.update({ where: { id: row.id }, data });
      users += 1;
    }
  }

  // The audit trail: the number as it read at the moment it was shown. It is
  // evidence in a violation report, so it is as sensitive as the profile.
  const shown = await raw.contactReveal.findMany({ select: { id: true, phoneShown: true } });
  for (const row of shown) {
    if (row.phoneShown && !isEncrypted(row.phoneShown)) {
      await raw.contactReveal.update({
        where: { id: row.id },
        data: { phoneShown: encrypt(row.phoneShown) },
      });
      reveals += 1;
    }
  }

  if (users || reveals) {
    logger.info('Encrypted contact columns', { users, reveals });
  } else {
    logger.info('Contact columns already encrypted');
  }
}

run()
  .catch((err) => {
    logger.error('Encryption backfill failed', { error: err.message });
    process.exitCode = 1;
  })
  .finally(() => raw.$disconnect());
