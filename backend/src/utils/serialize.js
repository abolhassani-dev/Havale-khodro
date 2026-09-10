const { prisma } = require('../config/database');

/**
 * One at a time, per key.
 *
 * Every allowance in this system — the reveals a subscription buys, the seats
 * a reseller paid for, the reports an agency may file in a day — is enforced
 * as «count what is used, compare with the limit, then write». Two requests
 * arriving together both count before either writes, and both pass; a
 * script firing thirty reveals at once harvested thirty numbers for one
 * allowance. The fix is not a bigger comparison but making the two steps
 * one: a PostgreSQL advisory lock, held for the length of the transaction,
 * keyed on whoever's allowance is being spent. A second request on the same
 * key waits at the lock and then counts the first one's write.
 *
 * Transaction-scoped (`xact`), so the lock releases with the commit or the
 * rollback and can never be left held by a crashed handler. `hashtext` folds
 * the key into the integer the lock takes; a collision between two agencies
 * would only make them wait for each other, never let one through.
 *
 * @param {string} key   what is being serialised, e.g. `reveal:<userId>`
 * @param {(tx: import('@prisma/client').Prisma.TransactionClient) => Promise<T>} fn
 * @returns {Promise<T>}
 * @template T
 */
function serialized(key, fn) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
    return fn(tx);
  });
}

module.exports = { serialized };
