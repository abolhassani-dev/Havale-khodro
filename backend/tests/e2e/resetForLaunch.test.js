const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const bcrypt = require('bcryptjs');

const app = require('../../src/app');
const { prisma, connectDatabase, disconnectDatabase } = require('../../src/config/database');
const { api, PASSWORD, catalog, offer, createAgent, giveSubscription, signIn } = require('../helpers/factory');
const { resetForLaunch, UPLOAD_SUBDIRS } = require('../../scripts/reset-for-launch');

/**
 * The launch-day wipe — the one script that cannot be undone.
 *
 * Tested from the outside like everything else: build a small trial period
 * (an agency with a ticket and an advertisement, and an administrator), run
 * the wipe, and check that the agency and its traces are gone while the
 * administrator, the catalogue and the price snapshot are exactly as they
 * were. The uploads folder is a temporary one, so this never touches the
 * files of the machine it runs on.
 *
 * Needs a database:  RUN_E2E=1 npm run test:e2e
 */
const maybe = process.env.RUN_E2E ? describe : describe.skip;

maybe('reset-for-launch', () => {
  const cleanEnv = { SEED_DEMO: 'false', ALLOW_DEMO_SEED: 'false' };
  let uploadsRoot;
  let admin;

  beforeAll(async () => {
    await connectDatabase();
    uploadsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'reset-'));
    for (const sub of UPLOAD_SUBDIRS) fs.mkdirSync(path.join(uploadsRoot, sub));

    const tag = `${Date.now()}${Math.floor(Math.random() * 999)}`;
    admin = await prisma.user.create({
      data: {
        username: `test_reset_admin_${tag}`,
        passwordHash: await bcrypt.hash(PASSWORD, 4),
        phone: `0916${tag.slice(-7)}`,
        fullName: 'مدیر تست',
        role: 'SUPER_ADMIN',
        mustChangePassword: false,
      },
    });
  });

  afterAll(async () => {
    fs.rmSync(uploadsRoot, { recursive: true, force: true });
    await prisma.user.deleteMany({ where: { id: admin.id } });
    await disconnectDatabase();
  });

  it('refuses while a demo switch is still on, and changes nothing', async () => {
    const agent = await createAgent();
    const res = await resetForLaunch({ apply: true, uploadsRoot, env: { SEED_DEMO: 'true' } });
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('SEED_DEMO');
    expect(await prisma.user.findUnique({ where: { id: agent.id } })).not.toBeNull();
  });

  it('only reports without --apply', async () => {
    const agent = await createAgent();
    const res = await resetForLaunch({ apply: false, uploadsRoot, env: cleanEnv });
    expect(res.ok).toBe(true);
    expect(res.deleted).toBeUndefined();
    expect(await prisma.user.findUnique({ where: { id: agent.id } })).not.toBeNull();
  });

  it('removes every agency and its traces, keeps staff, catalogue and prices, restarts the serials', async () => {
    // A trial period in miniature.
    const agent = await createAgent();
    await giveSubscription(agent);
    const cookie = await signIn(agent);
    const listing = await request(app).post(api('/havales')).set('Cookie', cookie).send(await offer()).expect(201);
    const ticket = await request(app)
      .post(api('/tickets'))
      .set('Cookie', cookie)
      .send({ subject: 'تست', category: 'OTHER', body: 'پیام آزمایشی' })
      .expect(201);
    const stray = path.join(uploadsRoot, 'cars', 'left-over.jpg');
    fs.writeFileSync(stray, 'x');

    const before = {
      staff: await prisma.user.count({ where: { role: { not: 'AGENT' } } }),
      models: await prisma.carModel.count(),
      brands: await prisma.carBrand.count(),
      plans: await prisma.plan.count(),
      prices: await prisma.carPriceItem.count(),
    };

    const res = await resetForLaunch({ apply: true, uploadsRoot, env: cleanEnv });
    expect(res.ok).toBe(true);
    expect(res.deleted.user).toBeGreaterThanOrEqual(1);
    expect(res.deleted.listing).toBeGreaterThanOrEqual(1);
    expect(res.deleted.ticket).toBeGreaterThanOrEqual(1);
    expect(res.files.cars).toBe(1);
    expect(fs.existsSync(stray)).toBe(false);

    // Gone.
    expect(await prisma.user.count({ where: { role: 'AGENT' } })).toBe(0);
    expect(await prisma.listing.count()).toBe(0);
    expect(await prisma.ticket.count()).toBe(0);
    expect(await prisma.activityLog.count()).toBe(0);
    expect(await prisma.subscription.count()).toBe(0);
    await request(app).get(api(`/havales/${listing.body.data.id}`)).set('Cookie', cookie).expect(401);

    // Untouched.
    expect(await prisma.user.findUnique({ where: { id: admin.id } })).not.toBeNull();
    expect(await prisma.user.count({ where: { role: { not: 'AGENT' } } })).toBe(before.staff);
    expect(await prisma.carModel.count()).toBe(before.models);
    expect(await prisma.carBrand.count()).toBe(before.brands);
    expect(await prisma.plan.count()).toBe(before.plans);
    expect(await prisma.carPriceItem.count()).toBe(before.prices);

    // The first real ticket is ticket 1 — and it was not before the wipe.
    expect(ticket.body.data.serial).toBeGreaterThanOrEqual(1);
    const fresh = await createAgent();
    await giveSubscription(fresh);
    const freshCookie = await signIn(fresh);
    const first = await request(app)
      .post(api('/tickets'))
      .set('Cookie', freshCookie)
      .send({ subject: 'اولین', category: 'OTHER', body: 'اولین تیکت واقعی' })
      .expect(201);
    expect(first.body.data.serial).toBe(1);
    const firstListing = await request(app).post(api('/havales')).set('Cookie', freshCookie).send(await offer()).expect(201);
    expect(firstListing.body.data.serial).toBe(1);

    // Leave the suite as it found it.
    await resetForLaunch({ apply: true, uploadsRoot, env: cleanEnv });
    expect((await catalog()).models.length).toBeGreaterThan(0);
  });
});
