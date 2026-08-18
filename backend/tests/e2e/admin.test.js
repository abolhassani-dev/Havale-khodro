const request = require('supertest');
const bcrypt = require('bcryptjs');

const app = require('../../src/app');
const { prisma, connectDatabase, disconnectDatabase } = require('../../src/config/database');
const { api, PASSWORD, offer, catalog, signIn, signedInAgent, cleanup } = require('../helpers/factory');

/**
 * The admin panel: creating agencies, monitoring, and editing the car catalogue.
 *
 * A large part of what follows is about who may *not* do things. The three admin
 * roles exist precisely so that hiring a support person does not hand them the
 * contact data the business rests on, and a role table nobody tests is a role
 * table that quietly stops being true.
 *
 * Needs a database:  RUN_E2E=1 npm run test:e2e
 */
const maybe = process.env.RUN_E2E ? describe : describe.skip;

maybe('admin panel', () => {
  const created = [];
  const catalogRows = { models: [], brands: [], companies: [], colors: [] };

  const agent = async (overrides) => {
    const signed = await signedInAgent(overrides);
    created.push(signed.user.id);
    return signed;
  };

  const staff = async (role) => {
    const tag = `${Date.now()}${Math.floor(Math.random() * 999)}`;
    const user = await prisma.user.create({
      data: {
        username: `test_${role.toLowerCase()}_${tag}`,
        passwordHash: await bcrypt.hash(PASSWORD, 4),
        phone: `0919${tag.slice(-7)}`,
        fullName: 'کارمند تست',
        role,
        mustChangePassword: false,
      },
    });
    created.push(user.id);
    return { user, cookie: await signIn(user) };
  };

  // Read once in beforeAll. Brand access is a required field on creation, so a
  // payload without it is not a valid agency — which is the point of the rule,
  // and is asserted directly in brandAccess.test.js.
  let anyBrandId = null;

  const agencyPayload = (brandIds = anyBrandId ? [anyBrandId] : []) => {
    const tag = `${Date.now()}${Math.floor(Math.random() * 9999)}`;
    return {
      username: `test_ag_${tag}`,
      password: 'Str0ngPassw0rd!',
      fullName: 'مدیر نمایندگی',
      phone: `0921${tag.slice(-7)}`,
      agencyCode: `T-${tag.slice(-8)}`,
      agencyName: 'نمایندگی جدید',
      city: 'شیراز',
      coordinatorName: 'مسئول هماهنگی',
      coordinatorPhone: '09210000000',
      brandIds,
    };
  };

  beforeAll(async () => {
    await connectDatabase();
    await catalog();
    const brand = await prisma.carBrand.findFirst({
      where: { isActive: true },
      select: { id: true },
    });
    anyBrandId = brand?.id || null;
  });

  afterAll(async () => {
    await prisma.havale.deleteMany({ where: { carModelId: { in: catalogRows.models } } });
    await prisma.carModel.deleteMany({ where: { id: { in: catalogRows.models } } });
    await prisma.carBrand.deleteMany({ where: { id: { in: catalogRows.brands } } });
    await prisma.carCompany.deleteMany({ where: { id: { in: catalogRows.companies } } });
    await prisma.carColor.deleteMany({ where: { id: { in: catalogRows.colors } } });
    await cleanup(created);
    await disconnectDatabase();
  });

  describe('creating agency accounts', () => {
    it('creates one and shows the password exactly once', async () => {
      const superAdmin = await staff('SUPER_ADMIN');
      const payload = agencyPayload();

      const res = await request(app)
        .post(api('/admin/agents'))
        .set('Cookie', superAdmin.cookie)
        .send(payload)
        .expect(201);
      created.push(res.body.data.id);

      // The only moment anyone can read it — nothing stores it in plain text.
      expect(res.body.data.initialPassword).toBe(payload.password);
      expect(res.body.data.mustChangePassword).toBe(true);
      expect(JSON.stringify(res.body)).not.toContain('passwordHash');

      const fetched = await request(app)
        .get(api(`/admin/agents/${res.body.data.id}`))
        .set('Cookie', superAdmin.cookie)
        .expect(200);
      expect(fetched.body.data.initialPassword).toBeUndefined();
    });

    it('refuses a duplicate agency code with a message that says which field', async () => {
      const superAdmin = await staff('SUPER_ADMIN');
      const payload = agencyPayload();

      const first = await request(app)
        .post(api('/admin/agents'))
        .set('Cookie', superAdmin.cookie)
        .send(payload)
        .expect(201);
      created.push(first.body.data.id);

      const clash = await request(app)
        .post(api('/admin/agents'))
        .set('Cookie', superAdmin.cookie)
        .send({ ...agencyPayload(), agencyCode: payload.agencyCode })
        .expect(409);

      // "Already exists" without saying what leaves the operator guessing which
      // of three unique fields collided.
      expect(clash.body.error.message).toContain('کد نمایندگی');
    });

    it('is closed to support and finance', async () => {
      for (const role of ['SUPPORT', 'FINANCE']) {
        const member = await staff(role);
        await request(app)
          .post(api('/admin/agents'))
          .set('Cookie', member.cookie)
          .send(agencyPayload())
          .expect(403);
      }
    });

    it('is closed to agents entirely', async () => {
      const { cookie } = await agent();
      await request(app).get(api('/admin/agents')).set('Cookie', cookie).expect(403);
    });
  });

  describe('managing an agency', () => {
    it('suspends, ends its sessions, and keeps the subscription', async () => {
      const superAdmin = await staff('SUPER_ADMIN');
      const target = await agent();

      await request(app)
        .put(api(`/admin/agents/${target.user.id}/status`))
        .set('Cookie', superAdmin.cookie)
        .send({ status: 'SUSPENDED' })
        .expect(200);

      // Suspension has to bite at once — for a fraudulent account, the window
      // until a session expires is the window that matters.
      await request(app).get(api('/auth/me')).set('Cookie', target.cookie).expect(403);

      const live = await prisma.subscription.count({
        where: { userId: target.user.id, status: 'ACTIVE' },
      });
      expect(live).toBe(1);
    });

    it('signs an agency out without suspending it', async () => {
      const superAdmin = await staff('SUPER_ADMIN');
      const target = await agent();

      const res = await request(app)
        .post(api(`/admin/agents/${target.user.id}/logout`))
        .set('Cookie', superAdmin.cookie)
        .expect(200);
      expect(res.body.data.endedSessions).toBe(1);

      await request(app).get(api('/auth/me')).set('Cookie', target.cookie).expect(401);

      // Still able to sign back in: this is a logout, not a punishment.
      await signIn(target.user);
    });

    it('lets support fix contact details but not suspend', async () => {
      const support = await staff('SUPPORT');
      const target = await agent();

      // The one change support is meant to be able to make (blueprint 11.12).
      const updated = await request(app)
        .patch(api(`/admin/agents/${target.user.id}`))
        .set('Cookie', support.cookie)
        .send({ coordinatorPhone: '09121112233' })
        .expect(200);
      expect(updated.body.data.coordinatorPhone).toBe('09121112233');

      await request(app)
        .put(api(`/admin/agents/${target.user.id}/status`))
        .set('Cookie', support.cookie)
        .send({ status: 'SUSPENDED' })
        .expect(403);
    });

    it('applies a corrected phone number to every listing at once', async () => {
      const support = await staff('SUPPORT');
      const owner = await agent();
      const viewer = await agent();

      const havale = await request(app)
        .post(api('/havales'))
        .set('Cookie', owner.cookie)
        .send(await offer())
        .expect(201);

      await request(app)
        .patch(api(`/admin/agents/${owner.user.id}`))
        .set('Cookie', support.cookie)
        .send({ coordinatorPhone: '09129998877' })
        .expect(200);

      const revealed = await request(app)
        .post(api(`/havales/${havale.body.data.id}/reveal`))
        .set('Cookie', viewer.cookie)
        .expect(200);

      // Listings read the profile live, so one correction fixes all of them
      // rather than none of them (blueprint 27).
      expect(revealed.body.data.contact.coordinatorPhone).toBe('09129998877');
    });

    it('raises one agency’s cap without touching the plan', async () => {
      const superAdmin = await staff('SUPER_ADMIN');
      const target = await agent();

      await request(app)
        .put(api(`/admin/agents/${target.user.id}/limits`))
        .set('Cookie', superAdmin.cookie)
        .send({ dailyRevealLimitOverride: 100, isReseller: true })
        .expect(200);

      const res = await request(app)
        .get(api('/subscriptions/me'))
        .set('Cookie', target.cookie)
        .expect(200);

      // The lever for one large customer, instead of inventing a plan for them.
      expect(res.body.data.limits.daily).toBe(100);
    });
  });

  describe('monitoring', () => {
    it('says in a sentence what a timeline entry means', async () => {
      const superAdmin = await staff('SUPER_ADMIN');
      const owner = await agent();
      const viewer = await agent();

      const havale = await request(app)
        .post(api('/havales'))
        .set('Cookie', owner.cookie)
        .send(await offer())
        .expect(201);

      await request(app)
        .post(api(`/havales/${havale.body.data.id}/reveal`))
        .set('Cookie', viewer.cookie)
        .expect(200);

      const timeline = await request(app)
        .get(api('/admin/activity'))
        .query({ userId: viewer.user.id, action: 'CONTACT_REVEALED' })
        .set('Cookie', superAdmin.cookie)
        .expect(200);

      expect(timeline.body.data.items.length).toBeGreaterThan(0);

      const entry = await request(app)
        .get(api(`/admin/activity/${timeline.body.data.items[0].id}`))
        .set('Cookie', superAdmin.cookie)
        .expect(200);

      // The whole point: a row of identifiers nobody can decode is not an audit
      // trail. This has to read as a sentence.
      expect(entry.body.data.description).toContain(viewer.user.agencyName);
      expect(entry.body.data.description).toContain('مشخصات تماس');
      expect(entry.body.data.target.owner.name).toContain(owner.user.agencyCode);
    });

    it('shows the number as it read at the time, not as it reads now', async () => {
      const superAdmin = await staff('SUPER_ADMIN');
      const support = await staff('SUPPORT');
      const owner = await agent();
      const viewer = await agent();

      const havale = await request(app)
        .post(api('/havales'))
        .set('Cookie', owner.cookie)
        .send(await offer())
        .expect(201);

      const originalPhone = owner.user.coordinatorPhone;
      await request(app)
        .post(api(`/havales/${havale.body.data.id}/reveal`))
        .set('Cookie', viewer.cookie)
        .expect(200);

      await request(app)
        .patch(api(`/admin/agents/${owner.user.id}`))
        .set('Cookie', support.cookie)
        .send({ coordinatorPhone: '09127776655' })
        .expect(200);

      const log = await request(app)
        .get(api('/admin/reveals'))
        .query({ viewerId: viewer.user.id })
        .set('Cookie', superAdmin.cookie)
        .expect(200);

      // Otherwise the log would quietly rewrite history and the evidence would
      // be worthless (review round 3, fix 6).
      expect(log.body.data.items[0].shown.phone).toBe(originalPhone);
    });

    it('keeps the reveal log away from support', async () => {
      const support = await staff('SUPPORT');
      // It is a list of phone numbers, and support does not hold the
      // contact-export permission (blueprint 11.12).
      await request(app).get(api('/admin/reveals')).set('Cookie', support.cookie).expect(403);
    });

    it('flags an agency that only looks and never posts', async () => {
      const superAdmin = await staff('SUPER_ADMIN');
      const owner = await agent();
      const collector = await agent({ dailyRevealLimitOverride: 100 });

      for (let i = 0; i < 3; i += 1) {
        const havale = await request(app)
          .post(api('/havales'))
          .set('Cookie', owner.cookie)
          .send(await offer())
          .expect(201);
        await request(app)
          .post(api(`/havales/${havale.body.data.id}/reveal`))
          .set('Cookie', collector.cookie)
          .expect(200);
      }

      const res = await request(app)
        .get(api('/admin/suspicious'))
        .query({ minReveals: 3 })
        .set('Cookie', superAdmin.cookie)
        .expect(200);

      const flagged = res.body.data.items.find((i) => i.agency.id === collector.user.id);
      expect(flagged).toBeDefined();
      expect(flagged.flags).toContain('NO_LISTINGS_MANY_REVEALS');
      // A flag somebody has to take on trust gets ignored after the first false
      // positive, so the numbers travel with it.
      expect(flagged.reason).toContain('هیچ حواله‌ای');
    });

    it('does not flag an agency that trades normally', async () => {
      const superAdmin = await staff('SUPER_ADMIN');
      const trader = await agent();

      await request(app)
        .post(api('/havales'))
        .set('Cookie', trader.cookie)
        .send(await offer())
        .expect(201);

      const res = await request(app)
        .get(api('/admin/suspicious'))
        .query({ minReveals: 3 })
        .set('Cookie', superAdmin.cookie)
        .expect(200);

      expect(res.body.data.items.some((i) => i.agency.id === trader.user.id)).toBe(false);
    });

    it('gives the dashboard its figures', async () => {
      const superAdmin = await staff('SUPER_ADMIN');
      const res = await request(app)
        .get(api('/admin/overview'))
        .set('Cookie', superAdmin.cookie)
        .expect(200);

      expect(res.body.data.agencies).toBeGreaterThan(0);
      expect(res.body.data).toHaveProperty('pendingReports');
      expect(res.body.data).toHaveProperty('openTickets');
    });
  });

  describe('settings screen', () => {
    it('returns every setting — including the BigInt-typed seat price', async () => {
      // seat.priceToman is parsed as BigInt, and JSON.stringify throws on
      // BigInt — so this endpoint answered 500 and the settings screen showed
      // "Something went wrong" with nothing in the server's own message to
      // point here. Money crosses the JSON boundary as a string.
      const superAdmin = await staff('SUPER_ADMIN');
      const res = await request(app)
        .get(api('/settings'))
        .set('Cookie', superAdmin.cookie)
        .expect(200);

      const keys = res.body.data.map((s) => s.key);
      expect(keys).toEqual(
        expect.arrayContaining(['seat.priceToman', 'sms.enabled', 'report.dailyLimit'])
      );

      const seatPrice = res.body.data.find((s) => s.key === 'seat.priceToman');
      expect(typeof seatPrice.value).toBe('string');
      expect(seatPrice.value).toMatch(/^\d+$/);
    });
  });

  describe('editing the car catalogue', () => {
    it('adds a model that agents can immediately use', async () => {
      const superAdmin = await staff('SUPER_ADMIN');
      const brand = await prisma.carBrand.findFirst({ where: { slug: 'mvm' } });

      const model = await request(app)
        .post(api('/admin/catalog/models'))
        .set('Cookie', superAdmin.cookie)
        .send({ brandId: brand.id, name: `test_مدل تازه ${Date.now()}` })
        .expect(201);
      catalogRows.models.push(model.body.data.id);

      const buyer = await agent();
      await request(app).get(api('/catalog')).set('Cookie', buyer.cookie).expect(200);

      const lazy = await request(app)
        .get(api(`/catalog/brands/${brand.id}/models`))
        .set('Cookie', buyer.cookie)
        .expect(200);
      expect(lazy.body.data.models.map((m) => m.id)).toContain(model.body.data.id);

      await request(app)
        .post(api('/havales'))
        .set('Cookie', buyer.cookie)
        .send(await offer({ carModelId: model.body.data.id }))
        .expect(201);
    });

    it('retires a model without breaking the listings already posted', async () => {
      const superAdmin = await staff('SUPER_ADMIN');
      const brand = await prisma.carBrand.findFirst({ where: { slug: 'fownix' } });

      const model = await request(app)
        .post(api('/admin/catalog/models'))
        .set('Cookie', superAdmin.cookie)
        .send({ brandId: brand.id, name: `test_مدل بازنشسته ${Date.now()}` })
        .expect(201);
      catalogRows.models.push(model.body.data.id);

      const owner = await agent();
      const existing = await request(app)
        .post(api('/havales'))
        .set('Cookie', owner.cookie)
        .send(await offer({ carModelId: model.body.data.id }))
        .expect(201);

      const usage = await request(app)
        .get(api(`/admin/catalog/models/${model.body.data.id}/usage`))
        .set('Cookie', superAdmin.cookie)
        .expect(200);
      // Shown before deactivating, so the effect is not a surprise.
      expect(usage.body.data.havales).toBe(1);

      await request(app)
        .patch(api(`/admin/catalog/models/${model.body.data.id}`))
        .set('Cookie', superAdmin.cookie)
        .send({ isActive: false })
        .expect(200);

      await request(app)
        .post(api('/havales'))
        .set('Cookie', owner.cookie)
        .send(await offer({ carModelId: model.body.data.id }))
        .expect(400);

      // "Removing a car" must never mean removing what was already advertised.
      await request(app)
        .get(api(`/havales/${existing.body.data.id}`))
        .set('Cookie', owner.cookie)
        .expect(200);
    });

    it('shows deactivated entries to the admin but not to agents', async () => {
      const superAdmin = await staff('SUPER_ADMIN');
      const brand = await prisma.carBrand.findFirst({ where: { slug: 'xtrim' } });

      const model = await request(app)
        .post(api('/admin/catalog/models'))
        .set('Cookie', superAdmin.cookie)
        .send({ brandId: brand.id, name: `test_مخفی ${Date.now()}` })
        .expect(201);
      catalogRows.models.push(model.body.data.id);

      await request(app)
        .patch(api(`/admin/catalog/models/${model.body.data.id}`))
        .set('Cookie', superAdmin.cookie)
        .send({ isActive: false })
        .expect(200);

      // Models come from the brand's own endpoint now rather than with the
      // catalogue: two thousand of them in one response is a page nobody can
      // read and a payload nobody should pay for.
      const adminView = await request(app)
        .get(api(`/admin/catalog/brands/${brand.id}/models`))
        .set('Cookie', superAdmin.cookie)
        .expect(200);
      // You cannot bring back something you cannot see.
      expect(adminView.body.data.models.map((m) => m.id)).toContain(model.body.data.id);

      const buyer = await agent();
      const agentView = await request(app)
        .get(api('/catalog'))
        .set('Cookie', buyer.cookie)
        .expect(200);
      expect(JSON.stringify(agentView.body)).not.toContain(model.body.data.id);
    });

    it('adds a colour agents can select', async () => {
      const superAdmin = await staff('SUPER_ADMIN');

      const color = await request(app)
        .post(api('/admin/catalog/colors'))
        .set('Cookie', superAdmin.cookie)
        .send({ name: `test_رنگ ${Date.now()}` })
        .expect(201);
      catalogRows.colors.push(color.body.data.id);

      const owner = await agent();
      await request(app)
        .post(api('/havales'))
        .set('Cookie', owner.cookie)
        .send(await offer({ carColor: color.body.data.name }))
        .expect(201);
    });

    it('records who changed the catalogue', async () => {
      const superAdmin = await staff('SUPER_ADMIN');
      const brand = await prisma.carBrand.findFirst({ where: { slug: 'mvm' } });

      const model = await request(app)
        .post(api('/admin/catalog/models'))
        .set('Cookie', superAdmin.cookie)
        .send({ brandId: brand.id, name: `test_ردیابی ${Date.now()}` })
        .expect(201);
      catalogRows.models.push(model.body.data.id);

      // An unexpected change to what every agency can advertise has to be
      // traceable to a person.
      const entry = await prisma.activityLog.findFirst({
        where: { userId: superAdmin.user.id, action: 'CATALOG_CHANGED' },
      });
      expect(entry).not.toBeNull();
    });

    it('is closed to support and finance', async () => {
      const brand = await prisma.carBrand.findFirst({ where: { slug: 'mvm' } });

      for (const role of ['SUPPORT', 'FINANCE']) {
        const member = await staff(role);
        await request(app)
          .post(api('/admin/catalog/models'))
          .set('Cookie', member.cookie)
          .send({ brandId: brand.id, name: 'test_ممنوع' })
          .expect(403);
      }
    });
  });
});
