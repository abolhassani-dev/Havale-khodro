const bcrypt = require('bcryptjs');
const request = require('supertest');

const app = require('../../src/app');
const config = require('../../src/config');
const { prisma } = require('../../src/config/database');
const { seedCatalog } = require('../../src/modules/catalog/catalog.seed');

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

/**
 * The catalogue, loaded once per run.
 *
 * Listings reference a model id rather than free text, so the tests need real
 * catalogue rows. Seeding is idempotent, so calling it from several suites is
 * safe.
 */
let catalogPromise = null;

function catalog() {
  if (!catalogPromise) {
    catalogPromise = seedCatalog().then(async () => {
      const models = await prisma.carModel.findMany({
        orderBy: { name: 'asc' },
        take: 2,
        select: { id: true, name: true },
      });
      const colors = await prisma.carColor.findMany({ take: 1, select: { name: true } });
      return { models, color: colors[0].name };
    });
  }
  return catalogPromise;
}

/** A fully specified sale listing, ready to POST. */
async function offer(overrides = {}) {
  const { models, color } = await catalog();
  return {
    kind: 'OFFER',
    carModelId: models[0].id,
    solh: 'SOLH',
    carColor: color,
    model: '1405',
    amountToman: 1_800_000_000,
    paidAmountToman: 900_000_000,
    deliveryDays: 60,
    depositDays: 5,
    ...overrides,
  };
}

/** A purchase request: car and transfer form only, as the product rule allows. */
async function purchaseRequest(overrides = {}) {
  const { models } = await catalog();
  return { kind: 'REQUEST', carModelId: models[1].id, solh: 'VEKALATI', ...overrides };
}

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
  catalog,
  offer,
  purchaseRequest,
  createAgent,
  giveSubscription,
  ensurePlan,
  signIn,
  signedInAgent,
  cleanup,
};
