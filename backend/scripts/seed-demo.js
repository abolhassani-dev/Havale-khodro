require('dotenv').config();

const bcrypt = require('bcryptjs');

const config = require('../src/config');
const { prisma, connectDatabase, disconnectDatabase } = require('../src/config/database');
const logger = require('../src/utils/logger');
const { addDays } = require('../src/utils/time');

/**
 * Demo data for a staging box.
 *
 * Enough agencies, listings and reveals that every screen has something on it —
 * an empty system is impossible to review, and reviewers end up saying "looks
 * fine" because there is nothing to look at.
 *
 * These accounts have a known password, so this must never run on a real
 * server. `seedDemo` refuses in production for that reason, and the switch that
 * calls it is off by default.
 */

const DEMO_PASSWORD = 'Demo@12345';

const AGENCIES = [
  { code: 'G-1001', name: 'نمایندگی البرز', city: 'کرج', user: 'alborz', reseller: true, seats: 5 },
  { code: 'G-1002', name: 'نمایندگی پارس', city: 'تهران', user: 'pars' },
  { code: 'G-1003', name: 'نمایندگی زاگرس', city: 'اصفهان', user: 'zagros' },
  { code: 'G-1004', name: 'نمایندگی خلیج فارس', city: 'شیراز', user: 'khalij' },
];

async function demoAgency(agency, plan, passwordHash, index) {
  const existing = await prisma.user.findUnique({ where: { username: agency.user } });
  if (existing) return existing;

  const user = await prisma.user.create({
    data: {
      username: agency.user,
      passwordHash,
      phone: `0912100000${index}`,
      fullName: `مدیر ${agency.name}`,
      role: 'AGENT',
      agencyCode: agency.code,
      agencyName: agency.name,
      city: agency.city,
      coordinatorName: `مسئول هماهنگی ${agency.city}`,
      coordinatorPhone: `0935100000${index}`,
      isReseller: Boolean(agency.reseller),
      seatCredits: agency.seats || 0,
      // Demo accounts skip the forced change, so a reviewer can sign straight in.
      mustChangePassword: false,
    },
  });

  await prisma.subscription.create({
    data: {
      userId: user.id,
      planId: plan.id,
      expiresAt: addDays(new Date(), 30),
      priceToman: plan.priceToman,
      origin: 'ADMIN',
    },
  });

  return user;
}

async function demoHavales(owners, models, colors) {
  const existing = await prisma.listing.count({ where: { ownerId: { in: owners.map((o) => o.id) } } });
  if (existing > 0) return;

  const amounts = [1_850_000_000n, 2_400_000_000n, 3_050_000_000n, 4_200_000_000n, 5_600_000_000n];

  for (const [index, model] of models.slice(0, 10).entries()) {
    const owner = owners[index % owners.length];
    const depositDays = 3 + (index % 5);

    await prisma.listing.create({
      data: {
        kind: index % 4 === 3 ? 'REQUEST' : 'OFFER',
        ownerId: owner.id,
        carModelId: model.id,
        carType: model.name,
        solh: index % 2 === 0 ? 'SOLH' : 'VEKALATI',
        carColor: index % 4 === 3 ? null : colors[index % colors.length].name,
        model: index % 2 === 0 ? '1405' : '1404',
        amountToman: amounts[index % amounts.length],
        paidAmountToman: amounts[index % amounts.length] / 2n,
        deliveryDays: 30 + index * 10,
        depositDays,
        supplierCompany: 'مدیران خودرو',
        description: index % 3 === 0 ? 'تحویل فوری، مدارک کامل.' : null,
        closesAt: addDays(new Date(), index % 4 === 3 ? 7 : depositDays),
      },
    });
  }
}

/** A few reveals, so the monitoring screens and the caps are not empty. */
async function demoReveals(agencies) {
  const havales = await prisma.listing.findMany({ take: 6, include: { owner: true } });

  for (const havale of havales) {
    const viewer = agencies.find((a) => a.id !== havale.ownerId);
    if (!viewer) continue;

    const already = await prisma.contactReveal.findUnique({
      where: { listingId_viewerId: { listingId: havale.id, viewerId: viewer.id } },
    });
    if (already) continue;

    await prisma.$transaction([
      prisma.contactReveal.create({
        data: {
          listingId: havale.id,
          viewerId: viewer.id,
          ip: '127.0.0.1',
          phoneShown: havale.owner.coordinatorPhone,
          agencyCodeShown: havale.owner.agencyCode,
        },
      }),
      prisma.listing.update({ where: { id: havale.id }, data: { revealCount: { increment: 1 } } }),
      prisma.activityLog.create({
        data: {
          userId: viewer.id,
          action: 'CONTACT_REVEALED',
          targetType: 'HAVALE',
          targetId: havale.id,
          summary: havale.owner.agencyCode,
          ip: '127.0.0.1',
        },
      }),
    ]);
  }
}

async function seedDemo() {
  if (config.isProduction && process.env.ALLOW_DEMO_SEED !== 'true') {
    // These accounts have a password written in this file, so refusing loudly
    // beats discovering them on a live system later. The message says what to do
    // about it, not only what went wrong — a refusal the reader cannot act on
    // gets worked around badly or ignored entirely.
    throw new Error(
      'Refusing to create demo accounts while NODE_ENV=production — their password is written in this repository. ' +
        'If this machine is a staging box nobody real uses yet, add ALLOW_DEMO_SEED=true to .env and restart. ' +
        'Remove it, and suspend the demo agencies, before the first real agency signs in.'
    );
  }

  await connectDatabase();

  const plan = await prisma.plan.findFirst({ where: { isActive: true } });
  if (!plan) throw new Error('Run `npm run seed` first — there is no plan to attach.');

  const [models, colors] = await Promise.all([
    prisma.carModel.findMany({ where: { isActive: true }, take: 10 }),
    prisma.carColor.findMany({ where: { isActive: true }, take: 5 }),
  ]);
  if (!models.length) throw new Error('Run `npm run seed` first — the catalogue is empty.');

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, config.security.bcryptRounds);
  const agencies = [];
  for (const [index, agency] of AGENCIES.entries()) {
    agencies.push(await demoAgency(agency, plan, passwordHash, index + 1));
  }

  await demoHavales(agencies, models, colors);
  await demoReveals(agencies);

  logger.info('Demo data ready', { agencies: agencies.length });
  // eslint-disable-next-line no-console
  console.log(
    `\n  demo agencies: ${AGENCIES.map((a) => a.user).join(', ')}\n  password:      ${DEMO_PASSWORD}\n`
  );

  await disconnectDatabase();
}

seedDemo().catch(async (err) => {
  logger.error('Demo seed failed', { error: err.message });
  await disconnectDatabase().catch(() => {});
  process.exit(1);
});
