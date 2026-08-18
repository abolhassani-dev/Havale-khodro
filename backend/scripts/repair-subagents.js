/* eslint-disable no-console */
/**
 * Repairs half-made sub-agency accounts.
 *
 * Before sub-agency creation became one transaction, a failure after the
 * account insert (a refused brand set, a dropped connection) left a child with
 * no seat subscription and possibly no brand grants. Such an account signs in
 * to «اشتراک منقضی» with no way to fix it from either panel.
 *
 * This finds every child whose parent holds a live subscription but who has no
 * live subscription of their own, and issues the missing PARENT_SEAT row —
 * exactly what creation would have written. Children with no brand grants are
 * reported (not fixed: which brands they were meant to hold is a human's
 * knowledge, and the admin panel's «برندهای مجاز» sets it in one minute).
 *
 * Dry-run by default. Run with --apply to write.
 *
 *   docker compose exec api node scripts/repair-subagents.js
 *   docker compose exec api node scripts/repair-subagents.js --apply
 */
const { prisma } = require('../src/config/database');

const APPLY = process.argv.includes('--apply');

async function main() {
  const children = await prisma.user.findMany({
    where: { role: 'AGENT', parentId: { not: null } },
    select: { id: true, username: true, agencyCode: true, agencyName: true, parentId: true },
  });
  console.log(`${children.length} sub-agency account(s) found.`);

  const now = new Date();
  let repaired = 0;

  for (const child of children) {
    const [ownLive, parentLive, grants] = await Promise.all([
      prisma.subscription.findFirst({
        where: { userId: child.id, status: 'ACTIVE', expiresAt: { gt: now } },
      }),
      prisma.subscription.findFirst({
        where: { userId: child.parentId, status: 'ACTIVE', expiresAt: { gt: now } },
        orderBy: { expiresAt: 'desc' },
      }),
      Promise.all([
        prisma.brandAccess.count({ where: { userId: child.id } }),
        prisma.modelAccess.count({ where: { userId: child.id } }),
      ]).then(([b, m]) => b + m),
    ]);

    const label = `${child.agencyCode} (${child.agencyName})`;

    if (!ownLive && parentLive) {
      repaired += 1;
      if (APPLY) {
        await prisma.subscription.create({
          data: {
            userId: child.id,
            planId: parentLive.planId,
            startsAt: now,
            // A placeholder, like creation writes: resolveAccess never reads a
            // seat's own expiry — it follows the parent's every time.
            expiresAt: new Date(now.getTime() + 3650 * 24 * 60 * 60 * 1000),
            priceToman: 0n,
            origin: 'PARENT_SEAT',
            createdById: child.parentId,
          },
        });
        console.log(`✔ ${label}: seat subscription issued.`);
      } else {
        console.log(`… ${label}: missing its seat subscription — would issue one.`);
      }
    } else if (!ownLive && !parentLive) {
      console.log(`! ${label}: parent has no live subscription either — nothing to attach to.`);
    }

    if (grants === 0) {
      console.log(`! ${label}: no brand or model grants — set them from the admin panel («برندهای مجاز»).`);
    }
  }

  if (!repaired) console.log('No missing seat subscriptions.');
  else if (!APPLY) console.log(`\nDry run. Re-run with --apply to issue ${repaired} seat subscription(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
