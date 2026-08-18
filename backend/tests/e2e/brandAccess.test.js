const request = require('supertest');

const app = require('../../src/app');
const { prisma, connectDatabase, disconnectDatabase } = require('../../src/config/database');
const bcrypt = require('bcryptjs');

const {
  api,
  PASSWORD,
  offer,
  purchaseRequest,
  catalog,
  signedInAgent,
  signIn,
  cleanup,
} = require('../helpers/factory');

/**
 * Which brands an agency may post under.
 *
 * The whole rule in one line: see everything, ask for anything, offer only what
 * you were given. That is how a main agency splits work across twenty
 * sub-agencies without any of them losing sight of the market.
 *
 * Needs a database:  RUN_E2E=1 npm run test:e2e
 */
const maybe = process.env.RUN_E2E ? describe : describe.skip;

maybe('brand access', () => {
  const created = [];
  let brands;

  const agent = async (overrides) => {
    const signed = await signedInAgent(overrides);
    created.push(signed.user.id);
    return signed;
  };

  // Staff accounts are not agencies, so the agent factory does not fit: they
  // have no agency profile and no brands of their own.
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

  beforeAll(async () => {
    await connectDatabase();
    await catalog();
    brands = await prisma.carBrand.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      take: 2,
      select: { id: true, name: true, models: { take: 1, select: { id: true } } },
    });
  });

  afterAll(async () => {
    await cleanup(created);
    await disconnectDatabase();
  });

  /** A model belonging to the brand at `index` in the fixture pair. */
  const modelOf = (index) => brands[index].models[0].id;

  it('lets an agency post an offer under a brand it holds', async () => {
    const { cookie } = await agent({ brands: [brands[0].id] });

    await request(app)
      .post(api('/havales'))
      .set('Cookie', cookie)
      .send(await offer({ carModelId: modelOf(0) }))
      .expect(201);
  });

  // The refusal names the brand. "You may not post this" without saying which
  // brand sends the reader to support to ask a question the message could have
  // answered itself.
  it('refuses an offer under a brand it does not hold, and says which', async () => {
    const { cookie } = await agent({ brands: [brands[0].id] });

    const res = await request(app)
      .post(api('/havales'))
      .set('Cookie', cookie)
      .send(await offer({ carModelId: modelOf(1) }))
      .expect(403);

    expect(res.body.error.message).toContain(brands[1].name);
  });

  // Wanting a car is not the same as dealing in it. A sub-agency that handles
  // Peugeot still buys whatever its customer walked in asking for, so the
  // restriction must not reach purchase requests.
  it('leaves purchase requests alone whatever the brand', async () => {
    const { cookie } = await agent({ brands: [brands[0].id] });

    await request(app)
      .post(api('/havales'))
      .set('Cookie', cookie)
      .send(await purchaseRequest({ carModelId: modelOf(1) }))
      .expect(201);
  });

  // A division of labour, not a wall. An agency that cannot see a listing
  // cannot broker it either, so searching stays whole.
  it('shows the whole market, flagging what may be posted', async () => {
    const { cookie } = await agent({ brands: [brands[0].id] });

    const res = await request(app).get(api('/catalog')).set('Cookie', cookie).expect(200);

    expect(res.body.data.brands.length).toBeGreaterThan(2);
    const first = res.body.data.brands.find((b) => b.id === brands[0].id);
    const second = res.body.data.brands.find((b) => b.id === brands[1].id);
    expect(first.canPost).toBe(true);
    expect(second.canPost).toBe(false);
  });

  // The default is nothing, not everything. An account nobody configured must
  // not be one that can post anything.
  it('gives a brand-new account no brands at all', async () => {
    const { cookie } = await agent({ brands: [] });

    await request(app)
      .post(api('/havales'))
      .set('Cookie', cookie)
      .send(await offer({ carModelId: modelOf(0) }))
      .expect(403);
  });

  // An edit can change the model, so without the same check a listing posted
  // under an allowed brand could be walked over to one this account never had.
  it('refuses to move an existing listing onto a brand it does not hold', async () => {
    const { cookie } = await agent({ brands: [brands[0].id] });

    const posted = await request(app)
      .post(api('/havales'))
      .set('Cookie', cookie)
      .send(await offer({ carModelId: modelOf(0) }))
      .expect(201);

    await request(app)
      .patch(api(`/havales/${posted.body.data.id}`))
      .set('Cookie', cookie)
      .send({ carModelId: modelOf(1) })
      .expect(403);
  });

  it('refuses to create an agency without choosing any brand', async () => {
    const { cookie } = await staff('SUPER_ADMIN');
    const tag = `${Date.now()}`;

    const body = {
      username: `test_nb${tag}`,
      password: 'Str0ngPassw0rd!',
      fullName: 'نماینده بدون برند',
      phone: `0912${tag.slice(-7)}`,
      agencyCode: `T-NB${tag.slice(-6)}`,
      agencyName: 'نمایندگی تست',
      city: 'تهران',
      coordinatorName: 'مسئول هماهنگی',
      coordinatorPhone: `0935${tag.slice(-7)}`,
    };

    // Absent entirely (schema), and present but adding up to nothing (route) —
    // the second is what a form submits when nobody ticks a box. A single
    // model with no brand is enough, which is the point of the model grain.
    await request(app).post(api('/admin/agents')).set('Cookie', cookie).send(body).expect(422);
    await request(app)
      .post(api('/admin/agents'))
      .set('Cookie', cookie)
      .send({ ...body, brandIds: [], modelIds: [] })
      .expect(400);
  });

  // The model grain: an agency whose whole job is one car.
  describe('single-model grants', () => {
    it('lets an account post exactly the granted model and nothing else of the brand', async () => {
      const twoModels = await prisma.carModel.findMany({
        where: { brandId: brands[0].id, isActive: true },
        take: 2,
        select: { id: true },
      });
      const { user, cookie } = await agent({ brands: [] });
      await prisma.modelAccess.create({
        data: { userId: user.id, carModelId: twoModels[0].id },
      });

      await request(app)
        .post(api('/havales'))
        .set('Cookie', cookie)
        .send(await offer({ carModelId: twoModels[0].id }))
        .expect(201);

      // The sibling model of the same brand stays closed — the grant was the
      // model, not the brand.
      await request(app)
        .post(api('/havales'))
        .set('Cookie', cookie)
        .send(await offer({ carModelId: twoModels[1].id }))
        .expect(403);
    });

    it('drops a model grant that its brand grant already covers', async () => {
      const { cookie } = await staff('SUPER_ADMIN');
      const target = await agent({ brands: [] });
      const model = await prisma.carModel.findFirst({
        where: { brandId: brands[0].id, isActive: true },
        select: { id: true },
      });

      await request(app)
        .put(api(`/admin/agents/${target.user.id}/brands`))
        .set('Cookie', cookie)
        .send({ brandIds: [brands[0].id], modelIds: [model.id] })
        .expect(200);

      // Only the brand row is stored: the model row would be a duplicate that
      // stops meaning anything the day the brand grant is removed.
      expect(await prisma.modelAccess.count({ where: { userId: target.user.id } })).toBe(0);
      expect(await prisma.brandAccess.count({ where: { userId: target.user.id } })).toBe(1);
    });

    it('a parent may hand down a single model it holds, and no other', async () => {
      const twoModels = await prisma.carModel.findMany({
        where: { brandId: brands[1].id, isActive: true },
        take: 2,
        select: { id: true },
      });
      const parent = await agent({ brands: [], isReseller: true, seatCredits: 5 });
      await prisma.modelAccess.create({
        data: { userId: parent.user.id, carModelId: twoModels[0].id },
      });

      const tag = `${Date.now()}${Math.floor(Math.random() * 999)}`;
      const body = {
        username: `test_m${tag}`,
        password: 'Str0ngPassw0rd!',
        fullName: 'زیرنمایندگی تک‌مدلی',
        phone: `0914${tag.slice(-7)}`,
        agencyName: 'زیرنمایندگی تست',
        city: 'قم',
        coordinatorName: 'مسئول هماهنگی',
        coordinatorPhone: `0937${tag.slice(-7)}`,
      };

      const ok = await request(app)
        .post(api('/sub-agents'))
        .set('Cookie', parent.cookie)
        .send({ ...body, brandIds: [], modelIds: [twoModels[0].id] })
        .expect(201);
      created.push(ok.body.data.id);

      await request(app)
        .post(api('/sub-agents'))
        .set('Cookie', parent.cookie)
        .send({
          ...body,
          username: `test_m2${tag}`,
          phone: `0915${tag.slice(-7)}`,
          brandIds: [],
          modelIds: [twoModels[1].id],
        })
        .expect(403);
    });
  });

  it('replaces the whole set when an admin saves the picker', async () => {
    const { cookie } = await staff('SUPER_ADMIN');
    const target = await agent({ brands: [brands[0].id] });

    await request(app)
      .put(api(`/admin/agents/${target.user.id}/brands`))
      .set('Cookie', cookie)
      .send({ brandIds: [brands[1].id] })
      .expect(200);

    const res = await request(app)
      .get(api(`/admin/agents/${target.user.id}/brands`))
      .set('Cookie', cookie)
      .expect(200);

    const on = res.body.data.brands.filter((b) => b.allowed).map((b) => b.id);
    expect(on).toEqual([brands[1].id]);
    expect(res.body.data.modelGrants).toEqual([]);
  });

  // The ceiling, which is what makes it safe to let a main agency configure its
  // own sub-agencies at all: it can divide what it holds and never mint more.
  describe('a parent creating a sub-agency', () => {
    const subAgencyBody = () => {
      const tag = `${Date.now()}${Math.floor(Math.random() * 999)}`;
      return {
        username: `test_sub${tag}`,
        password: 'Str0ngPassw0rd!',
        fullName: 'مدیر زیرنمایندگی',
        phone: `0913${tag.slice(-7)}`,
        agencyName: 'زیرنمایندگی تست',
        city: 'اصفهان',
        coordinatorName: 'مسئول هماهنگی',
        coordinatorPhone: `0936${tag.slice(-7)}`,
      };
    };

    const parentOf = async (brandIds) => {
      const signed = await agent({ brands: brandIds, isReseller: true, seatCredits: 5 });
      return signed;
    };

    it('may hand down a subset of its own brands', async () => {
      const parent = await parentOf([brands[0].id, brands[1].id]);

      const res = await request(app)
        .post(api('/sub-agents'))
        .set('Cookie', parent.cookie)
        .send({ ...subAgencyBody(), brandIds: [brands[0].id] })
        .expect(201);
      created.push(res.body.data.id);

      const rows = await prisma.brandAccess.findMany({
        where: { userId: res.body.data.id },
        select: { brandId: true },
      });
      expect(rows.map((r) => r.brandId)).toEqual([brands[0].id]);
    });

    it('may not hand down a brand it does not hold itself', async () => {
      const parent = await parentOf([brands[0].id]);
      const body = { ...subAgencyBody(), brandIds: [brands[1].id] };

      await request(app)
        .post(api('/sub-agents'))
        .set('Cookie', parent.cookie)
        .send(body)
        .expect(403);

      // And the refusal left nothing behind. The three-step version created
      // the account first and hit the ceiling second — the child existed with
      // no grants and no seat subscription, and signed in to an inexplicable
      // «اشتراک منقضی». A sub-agency exists whole or not at all.
      expect(await prisma.user.count({ where: { username: body.username } })).toBe(0);
    });

    // Omitting the field means "the same as mine", which is the right answer
    // for a sub-agency that is another desk rather than a specialised one.
    it('gives its own brands when none are named', async () => {
      const parent = await parentOf([brands[0].id, brands[1].id]);

      const res = await request(app)
        .post(api('/sub-agents'))
        .set('Cookie', parent.cookie)
        .send(subAgencyBody())
        .expect(201);
      created.push(res.body.data.id);

      const rows = await prisma.brandAccess.findMany({
        where: { userId: res.body.data.id },
        select: { brandId: true },
      });
      expect(rows.map((r) => r.brandId).sort()).toEqual([brands[0].id, brands[1].id].sort());
    });

    // Creation used to be the only moment a parent could choose a child's
    // brands — changing them afterwards took an administrator, for what is the
    // parent's own decision about its own brands.
    it('lets a parent re-divide an existing child, under the same ceiling', async () => {
      const parent = await parentOf([brands[0].id]);
      const made = await request(app)
        .post(api('/sub-agents'))
        .set('Cookie', parent.cookie)
        .send(subAgencyBody())
        .expect(201);
      created.push(made.body.data.id);
      const childId = made.body.data.id;

      // Narrow the child to one model of the brand.
      const model = await prisma.carModel.findFirst({
        where: { brandId: brands[0].id, isActive: true },
        select: { id: true },
      });
      await request(app)
        .put(api(`/sub-agents/${childId}/brands`))
        .set('Cookie', parent.cookie)
        .send({ brandIds: [], modelIds: [model.id] })
        .expect(200);

      const got = await request(app)
        .get(api(`/sub-agents/${childId}/brands`))
        .set('Cookie', parent.cookie)
        .expect(200);
      expect(got.body.data.brandIds).toEqual([]);
      expect(got.body.data.modelGrants.map((g) => g.id)).toEqual([model.id]);

      // The ceiling still holds: a brand the parent does not have is refused.
      await request(app)
        .put(api(`/sub-agents/${childId}/brands`))
        .set('Cookie', parent.cookie)
        .send({ brandIds: [brands[1].id], modelIds: [] })
        .expect(403);

      // And another agency cannot even learn the child exists.
      const stranger = await agent({ brands: [brands[0].id] });
      await request(app)
        .get(api(`/sub-agents/${childId}/brands`))
        .set('Cookie', stranger.cookie)
        .expect(404);
    });

    // The admin screen must obey the same ceiling as the parent: granting a
    // sub-agency a brand its central agency does not hold would let the child
    // post cars its own family may not.
    it('stops an admin from granting a child past its central agency', async () => {
      const parent = await parentOf([brands[0].id]);
      const made = await request(app)
        .post(api('/sub-agents'))
        .set('Cookie', parent.cookie)
        .send(subAgencyBody())
        .expect(201);
      created.push(made.body.data.id);
      const childId = made.body.data.id;

      const admin = await staff('SUPER_ADMIN');

      // The picker's choices are narrowed to the family's holdings.
      const got = await request(app)
        .get(api(`/admin/agents/${childId}/brands`))
        .set('Cookie', admin.cookie)
        .expect(200);
      expect(got.body.data.brands.map((b) => b.id)).toEqual([brands[0].id]);

      const over = await request(app)
        .put(api(`/admin/agents/${childId}/brands`))
        .set('Cookie', admin.cookie)
        .send({ brandIds: [brands[1].id] })
        .expect(403);
      expect(over.body.error.message).toContain('نمایندگی مرکزی');

      // Within the family it still works.
      await request(app)
        .put(api(`/admin/agents/${childId}/brands`))
        .set('Cookie', admin.cookie)
        .send({ brandIds: [brands[0].id] })
        .expect(200);
    });

    // The phone is unique across every account. Before the pre-check this died
    // on the database's constraint — a 500 that production renders as
    // «Something went wrong», which is how a real parent actually met it.
    it('refuses a phone number another account already holds, by name', async () => {
      const parent = await parentOf([brands[0].id]);
      const body = subAgencyBody();

      const first = await request(app)
        .post(api('/sub-agents'))
        .set('Cookie', parent.cookie)
        .send(body)
        .expect(201);
      created.push(first.body.data.id);

      const res = await request(app)
        .post(api('/sub-agents'))
        .set('Cookie', parent.cookie)
        .send({ ...subAgencyBody(), username: `test_dup${Date.now()}`, phone: body.phone })
        .expect(409);
      expect(res.body.error.message).toContain('شماره موبایل');

      // And no half-made account: the refusal happened before the insert.
      expect(
        await prisma.user.count({ where: { username: { startsWith: 'test_dup' } } })
      ).toBe(0);
    });
  });

  // A stale picker, or a hand-made request, must not be able to write rows that
  // point at nothing — those would read as access to a brand that is not there.
  it('refuses a brand id that is not a real brand', async () => {
    const { cookie } = await staff('SUPER_ADMIN');
    const target = await agent({ brands: [brands[0].id] });

    await request(app)
      .put(api(`/admin/agents/${target.user.id}/brands`))
      .set('Cookie', cookie)
      .send({ brandIds: [brands[0].id, 'clnotarealbrandid00000'] })
      .expect(400);

    // And nothing was written: the whole set is replaced in a transaction, so a
    // refused save must leave the previous one exactly as it was.
    const still = await prisma.brandAccess.findMany({
      where: { userId: target.user.id },
      select: { brandId: true },
    });
    expect(still.map((r) => r.brandId)).toEqual([brands[0].id]);
  });
});
