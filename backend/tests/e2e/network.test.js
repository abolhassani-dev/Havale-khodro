const request = require('supertest');

const app = require('../../src/app');
const { prisma, connectDatabase, disconnectDatabase } = require('../../src/config/database');
const {
  api,
  PASSWORD,
  catalog,
  offer,
  createAgent,
  giveSubscription,
  signIn,
  cleanup,
} = require('../helpers/factory');
const bcrypt = require('bcryptjs');

/**
 * «فقط شبکه‌ی من» — an advertisement for the owner's network alone.
 *
 * The rule is one rule for three markets, so it is tested once per market
 * from the outside: the network sees it, the rest of the market does not —
 * not in the list and not by id — the flag can be turned on and off by its
 * owner, an account with no network cannot set it, and the desk sees it all.
 *
 * Needs a database:  RUN_E2E=1 npm run test:e2e
 */
const maybe = process.env.RUN_E2E ? describe : describe.skip;

maybe('network-only listings', () => {
  const created = [];
  const track = (u) => (created.push(u.id), u);
  let models;

  const agent = async (over = {}) => {
    const user = track(await createAgent(over));
    await giveSubscription(user);
    return { user, cookie: await signIn(user) };
  };

  /** A reseller, one of its branches, and an agency outside the family. */
  const family = async () => {
    const parent = await agent({ isReseller: true, seatCredits: 5 });
    const child = await agent({ parentId: parent.user.id });
    const outsider = await agent();
    return { parent, child, outsider };
  };

  const YEAR = 1405;
  const payloads = {
    havales: () => offer({ visibility: 'NETWORK' }),
    registrations: async () => ({
      kind: 'OFFER',
      carModelId: models[0].id,
      planName: 'فروش فوق‌العاده',
      method: 'LOTTERY',
      saleType: 'PRESALE',
      capacity: 2,
      depositToman: 550_000_000,
      premiumToman: 180_000_000,
      visibility: 'NETWORK',
    }),
    cars: async () => ({
      kind: 'OFFER',
      carModelId: models[0].id,
      year: YEAR - 1,
      mileageKm: 38000,
      carColor: 'سفید',
      warranty: true,
      carPriceToman: 1_140_000_000,
      bodyStatus: {},
      visibility: 'NETWORK',
    }),
  };

  const post = (path, cookie, body) => request(app).post(api(`/${path}`)).set('Cookie', cookie).send(body);
  const list = (path, cookie, q = {}) => request(app).get(api(`/${path}`)).set('Cookie', cookie).query({ page: 1, ...q });
  const get = (path, cookie, id) => request(app).get(api(`/${path}/${id}`)).set('Cookie', cookie);
  const ids = (res) => (res.body.data.items || []).map((i) => i.id);

  beforeAll(async () => {
    await connectDatabase();
    ({ models } = await catalog());
  });

  afterAll(async () => {
    await cleanup(created);
    await disconnectDatabase();
  });

  describe.each(['havales', 'registrations', 'cars'])('%s', (path) => {
    it('is seen by the network — the parent, the branch — and by nobody else', async () => {
      const { parent, child, outsider } = await family();
      const posted = await post(path, parent.cookie, await payloads[path]()).expect(201);
      const id = posted.body.data.id;
      expect(posted.body.data.visibility).toBe('NETWORK');

      // The branch: in the list, and by id, with the badge on it.
      const seenByChild = await list(path, child.cookie).expect(200);
      expect(ids(seenByChild)).toContain(id);
      const byId = await get(path, child.cookie, id).expect(200);
      expect(byId.body.data.visibility).toBe('NETWORK');

      // The outsider: neither. And «not found» rather than «forbidden», so
      // the id does not confirm that something is there.
      const seenByOutsider = await list(path, outsider.cookie).expect(200);
      expect(ids(seenByOutsider)).not.toContain(id);
      await get(path, outsider.cookie, id).expect(404);
    });

    it('is seen by the parent when a branch posts it, and can be switched back to public', async () => {
      const { parent, child, outsider } = await family();
      const posted = await post(path, child.cookie, await payloads[path]()).expect(201);
      const id = posted.body.data.id;

      expect(ids(await list(path, parent.cookie).expect(200))).toContain(id);
      expect(ids(await list(path, outsider.cookie).expect(200))).not.toContain(id);

      // The owner opens it to the market — and the change is an edit like
      // any other, in the log with a before and an after.
      const edited = await request(app)
        .patch(api(`/${path}/${id}`))
        .set('Cookie', child.cookie)
        .send({ visibility: 'PUBLIC' })
        .expect(200);
      expect(edited.body.data.visibility).toBe('PUBLIC');
      expect(ids(await list(path, outsider.cookie).expect(200))).toContain(id);
      await get(path, outsider.cookie, id).expect(200);

      const log = await prisma.activityLog.findFirst({
        where: { userId: child.user.id, targetId: id, action: { endsWith: '_UPDATED' } },
        orderBy: { createdAt: 'desc' },
      });
      expect(JSON.stringify(log.changes)).toContain('نمایش');

      // And back again.
      await request(app)
        .patch(api(`/${path}/${id}`))
        .set('Cookie', child.cookie)
        .send({ visibility: 'NETWORK' })
        .expect(200);
      expect(ids(await list(path, outsider.cookie).expect(200))).not.toContain(id);
    });

    it('is refused from an account that has no network', async () => {
      const loner = await agent();
      const res = await post(path, loner.cookie, await payloads[path]());
      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('شبکه');
    });

    it('honours the «only my network» filter for the branch', async () => {
      const { parent, child, outsider } = await family();
      const mine = (await post(path, parent.cookie, await payloads[path]())).body.data.id;
      const theirs = (await post(path, outsider.cookie, { ...(await payloads[path]()), visibility: 'PUBLIC' })).body.data.id;

      const filtered = await list(path, child.cookie, { network: 'mine' }).expect(200);
      expect(ids(filtered)).toContain(mine);
      expect(ids(filtered)).not.toContain(theirs);
    });
  });

  it('shows every network-only row to the desk, with a filter for them', async () => {
    const { parent } = await family();
    const id = (await post('havales', parent.cookie, await payloads.havales())).body.data.id;

    const tag = `${Date.now()}${Math.floor(Math.random() * 999)}`;
    const admin = track(
      await prisma.user.create({
        data: {
          username: `test_net_admin_${tag}`,
          passwordHash: await bcrypt.hash(PASSWORD, 4),
          phone: `0915${tag.slice(-7)}`,
          fullName: 'مدیر تست',
          role: 'SUPER_ADMIN',
          mustChangePassword: false,
        },
      })
    );
    const cookie = await signIn(admin);

    const all = await request(app)
      .get(api('/admin/havales'))
      .set('Cookie', cookie)
      .query({ market: 'HAVALE', status: 'LIVE', visibility: 'NETWORK', take: 100 })
      .expect(200);
    const row = all.body.data.items.find((r) => r.id === id);
    expect(row).toBeDefined();
    expect(row.visibility).toBe('NETWORK');
  });
});
