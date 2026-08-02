const bcrypt = require('bcryptjs');
const request = require('supertest');

const app = require('../../src/app');
const config = require('../../src/config');
const { prisma } = require('../../src/config/database');

/**
 * Test data.
 *
 * Every record is prefixed `test_` and every helper hands back an id, so a suite
 * can delete exactly what it made. Shared fixtures across suites would couple
 * them together and make a failure in one look like a failure in another.
 */

const PASSWORD = 'Str0ngPassw0rd!';
const api = (path) => `${config.apiPrefix}${path}`;

let counter = 0;
const unique = () => `${Date.now()}${(counter += 1)}`;

async function createAgent(overrides = {}) {
  const tag = unique();
  return prisma.user.create({
    data: {
      username: `test_${tag}`,
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      phone: `0912${tag.slice(-7)}`,
      fullName: 'نماینده تست',
      role: 'AGENT',
      agencyCode: `T-${tag.slice(-8)}`,
      agencyName: 'نمایندگی تست',
      city: 'تهران',
      coordinatorName: 'مسئول هماهنگی',
      coordinatorPhone: `0935${tag.slice(-7)}`,
      mustChangePassword: false,
      ...overrides,
    },
  });
}

async function ensurePlan() {
  return prisma.plan.upsert({
    where: { name: 'test_plan' },
    update: {},
    create: {
      name: 'test_plan',
      durationDays: 30,
      priceToman: 25_000_000n,
      dailyRevealLimit: 30,
      monthlyRevealLimit: 300,
    },
  });
}

async function giveSubscription(user, { days = 30, ...rest } = {}) {
  const plan = await ensurePlan();
  return prisma.subscription.create({
    data: {
      userId: user.id,
      planId: plan.id,
      expiresAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
      priceToman: plan.priceToman,
      ...rest,
    },
  });
}

/** Signs in and returns the cookie header, ready to pass to `.set('Cookie', ...)`. */
async function signIn(user) {
  const res = await request(app)
    .post(api('/auth/login'))
    .send({ username: user.username, password: PASSWORD });
  if (res.status !== 200) {
    throw new Error(`sign-in failed for ${user.username}: ${res.status} ${res.text}`);
  }
  return res.headers['set-cookie'];
}

/** An agent with a live subscription and a session — the common starting point. */
async function signedInAgent(overrides = {}) {
  const user = await createAgent(overrides);
  await giveSubscription(user);
  return { user, cookie: await signIn(user) };
}

const OFFER = {
  kind: 'OFFER',
  carType: 'فیدلیتی پرایم',
  solh: 'SOLH',
  carColor: 'سفید',
  model: '1404',
  amountToman: 1_800_000_000,
  paidAmountToman: 900_000_000,
  deliveryDays: 60,
  depositDays: 5,
  supplierCompany: 'مدیران خودرو',
};

const REQUEST = {
  kind: 'REQUEST',
  carType: 'آریزو ۶',
  solh: 'VEKALATI',
};

/** Removes everything a suite created, children first. */
async function cleanup(userIds) {
  if (!userIds.length) return;
  const havales = await prisma.havale.findMany({
    where: { ownerId: { in: userIds } },
    select: { id: true },
  });
  const havaleIds = havales.map((h) => h.id);

  await prisma.contactReveal.deleteMany({
    where: { OR: [{ viewerId: { in: userIds } }, { havaleId: { in: havaleIds } }] },
  });
  await prisma.havale.deleteMany({ where: { ownerId: { in: userIds } } });
  await prisma.activityLog.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.subscription.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

module.exports = {
  api,
  PASSWORD,
  OFFER,
  REQUEST,
  createAgent,
  giveSubscription,
  ensurePlan,
  signIn,
  signedInAgent,
  cleanup,
};
