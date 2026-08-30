const bcrypt = require('bcryptjs');
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
  signedInAgent,
  cleanup,
} = require('../helpers/factory');

/**
 * The ثبت‌نامی market.
 *
 * Two things are being checked here and they are different in kind. The first
 * is this market's own rules: what a capacity offer must say, how long it
 * lives, who may post one. The second is the architecture the whole panel now
 * rests on — that two markets share one contact allowance and one moderation
 * flow while staying invisible to each other's queries. The second set is the
 * one that would fail silently if the isolation ever broke.
 *
 * Needs a database:  RUN_E2E=1 npm run test:e2e
 */
const maybe = process.env.RUN_E2E ? describe : describe.skip;

maybe('registration market', () => {
  const created = [];
  let models = [];

  const agent = async (overrides) => {
    const signed = await signedInAgent(overrides);
    created.push(signed.user.id);
    return signed;
  };

  const capacity = (over = {}) => ({
    kind: 'OFFER',
    carModelId: models[0].id,
    planName: 'فروش فوق‌العاده مرداد ۱۴۰۵',
    method: 'LOTTERY',
    saleType: 'PRESALE',
    capacity: 4,
    depositToman: 550_000_000,
    premiumToman: 180_000_000,
    ...over,
  });

  const wanted = (over = {}) => ({ kind: 'REQUEST', carModelId: models[1].id, ...over });

  const post = (cookie, payload) =>
    request(app).post(api('/registrations')).set('Cookie', cookie).send(payload);

  beforeAll(async () => {
    await connectDatabase();
    ({ models } = await catalog());
  });

  afterAll(async () => {
    await cleanup(created);
    await disconnectDatabase();
  });

  describe('announcing capacity', () => {
    it('keeps the scheme, the terms and the prices', async () => {
      const { cookie } = await agent();

      const res = await post(cookie, capacity()).expect(201);

      expect(res.body.data.planName).toBe('فروش فوق‌العاده مرداد ۱۴۰۵');
      expect(res.body.data.method).toBe('LOTTERY');
      expect(res.body.data.saleType).toBe('PRESALE');
      expect(res.body.data.capacity).toBe(4);
      // The two amounts people confuse: what the factory takes, and what this
      // agency takes.
      expect(res.body.data.depositToman).toBe(550_000_000);
      expect(res.body.data.premiumToman).toBe(180_000_000);
    });

    it('refuses an offer that does not say how the scheme allocates or what it costs', async () => {
      const { cookie } = await agent();

      for (const missing of ['planName', 'method', 'saleType', 'capacity', 'premiumToman']) {
        const payload = capacity();
        delete payload[missing];
        await post(cookie, payload).expect(422);
      }
    });

    it('asks a request for nothing but the car', async () => {
      const { cookie } = await agent();

      const res = await post(cookie, wanted()).expect(201);
      expect(res.body.data.kind).toBe('REQUEST');
      expect(res.body.data.planName).toBeNull();
    });
  });

  /**
   * The brand rule, which is the one the owner asked for by name: an agency may
   * only announce capacity for brands its account was given.
   */
  describe('brand access', () => {
    it('refuses to announce capacity for a brand this account was not given', async () => {
      const model = await prisma.carModel.findFirst({
        where: { id: models[0].id },
        select: { brandId: true },
      });
      const other = await prisma.carBrand.findFirst({
        where: { id: { not: model.brandId }, isActive: true },
        select: { id: true },
      });

      const user = await createAgent({ brands: [other.id] });
      created.push(user.id);
      await giveSubscription(user);
      const cookie = await signIn(user);

      const res = await post(cookie, capacity()).expect(403);
      // The refusal names the brand and says the other side is still open,
      // because «اجازه ندارید» alone sends people to support.
      expect(res.body.error.message).toContain('اجازه‌ی ثبت آگهی');
      expect(res.body.error.message).toContain('درخواست خرید');
    });

    it('still lets that account ask for the same car', async () => {
      const model = await prisma.carModel.findFirst({
        where: { id: models[1].id },
        select: { brandId: true },
      });
      const other = await prisma.carBrand.findFirst({
        where: { id: { not: model.brandId }, isActive: true },
        select: { id: true },
      });

      const user = await createAgent({ brands: [other.id] });
      created.push(user.id);
      await giveSubscription(user);
      const cookie = await signIn(user);

      // Buying is not restricted: an agency buys whatever its own customer
      // walked in asking for.
      await post(cookie, wanted()).expect(201);
    });
  });

  describe('how long an advertisement lives', () => {
    it('closes an offer on the scheme’s own deadline', async () => {
      const { cookie } = await agent();
      const deadline = new Date(Date.now() + 9 * 24 * 60 * 60 * 1000);

      const res = await post(cookie, capacity({ registerDeadline: deadline })).expect(201);

      expect(new Date(res.body.data.closesAt).toDateString()).toBe(deadline.toDateString());
    });

    it('never lets a distant deadline hold an advertisement all season', async () => {
      const { cookie } = await agent();
      const far = new Date(Date.now() + 200 * 24 * 60 * 60 * 1000);

      const res = await post(cookie, capacity({ registerDeadline: far })).expect(201);

      const days = (new Date(res.body.data.closesAt) - Date.now()) / (24 * 60 * 60 * 1000);
      expect(days).toBeLessThan(31);
    });

    it('gives a request seven days', async () => {
      const { cookie } = await agent();

      const res = await post(cookie, wanted()).expect(201);

      const days = (new Date(res.body.data.closesAt) - Date.now()) / (24 * 60 * 60 * 1000);
      expect(days).toBeGreaterThan(6);
      expect(days).toBeLessThan(8);
    });
  });

  describe('who may see a contact', () => {
    it('hides the advertiser until the view is paid for, then shows it', async () => {
      const owner = await agent();
      const viewer = await agent();
      const made = await post(owner.cookie, capacity()).expect(201);

      const listed = await request(app)
        .get(api('/registrations'))
        .set('Cookie', viewer.cookie)
        .expect(200);
      const row = listed.body.data.items.find((r) => r.id === made.body.data.id);
      expect(row.contact).toBeNull();
      expect(row.agency).toBeNull();
      // Not merely absent from the card — absent from the response entirely.
      expect(JSON.stringify(listed.body)).not.toContain(owner.user.coordinatorPhone);

      const shown = await request(app)
        .post(api(`/registrations/${made.body.data.id}/reveal`))
        .set('Cookie', viewer.cookie)
        .expect(200);
      expect(shown.body.data.contact.coordinatorPhone).toBe(owner.user.coordinatorPhone);
    });

    /**
     * One subscription, one allowance.
     *
     * This is the decision that says the markets are one product: a view spent
     * in ثبت‌نامی is a view not available in حواله. If this ever stops being
     * true, the daily cap silently doubles.
     */
    it('spends from the same allowance as the حواله market', async () => {
      const viewer = await agent();
      const owner = await agent();

      const reg = await post(owner.cookie, capacity()).expect(201);
      const hav = await request(app)
        .post(api('/havales'))
        .set('Cookie', owner.cookie)
        .send(await offer())
        .expect(201);

      const before = await request(app)
        .get(api('/havales/reveal-usage'))
        .set('Cookie', viewer.cookie)
        .expect(200);

      await request(app)
        .post(api(`/registrations/${reg.body.data.id}/reveal`))
        .set('Cookie', viewer.cookie)
        .expect(200);

      const after = await request(app)
        .get(api('/havales/reveal-usage'))
        .set('Cookie', viewer.cookie)
        .expect(200);

      expect(after.body.data.dailyUsed).toBe(before.body.data.dailyUsed + 1);

      // And the other direction: the حواله market sees the registration spend.
      const havReveal = await request(app)
        .post(api(`/havales/${hav.body.data.id}/reveal`))
        .set('Cookie', viewer.cookie)
        .expect(200);
      expect(havReveal.body.data.usage.dailyUsed).toBe(before.body.data.dailyUsed + 2);
    });

    it('does not charge twice for the same advertisement', async () => {
      const owner = await agent();
      const viewer = await agent();
      const made = await post(owner.cookie, capacity()).expect(201);

      const first = await request(app)
        .post(api(`/registrations/${made.body.data.id}/reveal`))
        .set('Cookie', viewer.cookie)
        .expect(200);
      const second = await request(app)
        .post(api(`/registrations/${made.body.data.id}/reveal`))
        .set('Cookie', viewer.cookie)
        .expect(200);

      expect(second.body.data.usage.dailyUsed).toBe(first.body.data.usage.dailyUsed);
    });
  });

  /**
   * The architectural promise, asserted rather than assumed: the two markets
   * live in one table and neither can see the other.
   */
  describe('the markets stay apart', () => {
    it('keeps a registration out of the حواله list and a حواله out of this one', async () => {
      const owner = await agent();
      const viewer = await agent();

      const reg = await post(owner.cookie, capacity()).expect(201);
      const hav = await request(app)
        .post(api('/havales'))
        .set('Cookie', owner.cookie)
        .send(await offer())
        .expect(201);

      const havales = await request(app)
        .get(api('/havales?limit=50'))
        .set('Cookie', viewer.cookie)
        .expect(200);
      expect(havales.body.data.items.some((h) => h.id === reg.body.data.id)).toBe(false);

      const registrations = await request(app)
        .get(api('/registrations?limit=50'))
        .set('Cookie', viewer.cookie)
        .expect(200);
      expect(registrations.body.data.items.some((r) => r.id === hav.body.data.id)).toBe(false);

      // Nor by id: asking one market for the other's advertisement is a 404,
      // not a half-rendered row with missing fields.
      await request(app)
        .get(api(`/registrations/${hav.body.data.id}`))
        .set('Cookie', viewer.cookie)
        .expect(404);
    });

    it('counts both markets in «my listings» separately', async () => {
      const owner = await agent();
      const reg = await post(owner.cookie, capacity()).expect(201);

      const mine = await request(app)
        .get(api('/registrations/mine'))
        .set('Cookie', owner.cookie)
        .expect(200);
      expect(mine.body.data.items.some((r) => r.id === reg.body.data.id)).toBe(true);

      const havMine = await request(app)
        .get(api('/havales/mine'))
        .set('Cookie', owner.cookie)
        .expect(200);
      expect(havMine.body.data.items.some((r) => r.id === reg.body.data.id)).toBe(false);
    });
  });

  describe('the agency’s own advertisements', () => {
    it('shows a central agency its sub-agencies’ ones, without letting it edit them', async () => {
      const parent = await agent({ isReseller: true, seatCredits: 3 });
      const child = await createAgent({ parentId: parent.user.id });
      created.push(child.id);
      await giveSubscription(child, { origin: 'PARENT_SEAT' });
      const childCookie = await signIn(child);

      const theirs = await post(childCookie, capacity()).expect(201);

      const family = await request(app)
        .get(api('/registrations/mine?scope=all'))
        .set('Cookie', parent.cookie)
        .expect(200);
      const row = family.body.data.items.find((r) => r.id === theirs.body.data.id);
      expect(row).toBeTruthy();
      // Visible, and marked as not the parent's own — which is what the panel
      // uses to leave the edit buttons off that row.
      expect(row.isOwn).toBe(false);

      // And the server agrees: editing somebody else's advertisement is a 404.
      await request(app)
        .patch(api(`/registrations/${theirs.body.data.id}`))
        .set('Cookie', parent.cookie)
        .send({ capacity: 9 })
        .expect(404);
    });

    it('closes an advertisement when the capacity is handed over', async () => {
      const owner = await agent();
      const made = await post(owner.cookie, capacity()).expect(201);

      await request(app)
        .post(api(`/registrations/${made.body.data.id}/fulfill`))
        .set('Cookie', owner.cookie)
        .expect(200);

      const mine = await request(app)
        .get(api('/registrations/mine'))
        .set('Cookie', owner.cookie)
        .expect(200);
      expect(mine.body.data.items.find((r) => r.id === made.body.data.id).status).toBe('FULFILLED');
    });
  });

  describe('an expired subscription', () => {
    it('sees the market but neither posts nor reveals', async () => {
      const owner = await agent();
      const made = await post(owner.cookie, capacity()).expect(201);

      const lapsed = await agent();
      await prisma.subscription.updateMany({
        where: { userId: lapsed.user.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const listed = await request(app)
        .get(api('/registrations'))
        .set('Cookie', lapsed.cookie)
        .expect(200);
      expect(listed.body.data.items.some((r) => r.id === made.body.data.id)).toBe(true);

      await post(lapsed.cookie, capacity()).expect(403);
      await request(app)
        .post(api(`/registrations/${made.body.data.id}/reveal`))
        .set('Cookie', lapsed.cookie)
        .expect(403);
    });
  });

  /**
   * One desk, one screen per market.
   *
   * The moderation code is shared — the same list, the same suspend, the same
   * soft delete — but an administrator asked to look at ثبت‌نامی must not have
   * to read past حواله rows, and the fields on the screen must be this
   * market's own. Both come from the registry, so this is also the test that
   * fails if a market ever stops announcing itself.
   */
  describe('the moderation desk', () => {
    const staff = async () => {
      const tag = `${Date.now()}${Math.floor(Math.random() * 999)}`;
      const user = await prisma.user.create({
        data: {
          username: `test_admin_${tag}`,
          passwordHash: await bcrypt.hash(PASSWORD, 4),
          phone: `0919${tag.slice(-7)}`,
          fullName: 'کارمند تست',
          role: 'SUPER_ADMIN',
          mustChangePassword: false,
        },
      });
      created.push(user.id);
      return { user, cookie: await signIn(user) };
    };

    it('gives each market its own list, with that market’s own fields', async () => {
      const owner = await agent();
      const { cookie } = await staff();

      const reg = await post(owner.cookie, capacity()).expect(201);
      const hav = await request(app)
        .post(api('/havales'))
        .set('Cookie', owner.cookie)
        .send(await offer())
        .expect(201);

      const regDesk = await request(app)
        .get(api('/admin/havales?market=REGISTRATION&take=100'))
        .set('Cookie', cookie)
        .expect(200);
      const row = regDesk.body.data.items.find((r) => r.id === reg.body.data.id);
      expect(row).toBeTruthy();
      expect(regDesk.body.data.items.some((r) => r.id === hav.body.data.id)).toBe(false);

      // The row carries this market's summary, under names the shared table
      // never had to learn: a plan, a method, and one headline figure.
      expect(row.marketLabel).toBe('ثبت‌نامی');
      expect(row.planName).toBe('فروش فوق‌العاده مرداد ۱۴۰۵');
      expect(row.method).toBe('قرعه‌کشی');
      expect(row.headlineToman).toBe(180_000_000);

      const havDesk = await request(app)
        .get(api('/admin/havales?market=HAVALE&take=100'))
        .set('Cookie', cookie)
        .expect(200);
      expect(havDesk.body.data.items.some((h) => h.id === hav.body.data.id)).toBe(true);
      expect(havDesk.body.data.items.some((h) => h.id === reg.body.data.id)).toBe(false);
    });

    it('describes one advertisement in the words of its own market', async () => {
      const owner = await agent();
      const { cookie } = await staff();
      const made = await post(owner.cookie, capacity({ conditions: 'کد ملی بدون سابقه' })).expect(201);

      const detail = await request(app)
        .get(api(`/admin/havales/${made.body.data.id}`))
        .set('Cookie', cookie)
        .expect(200);

      const labels = detail.body.data.fields.map((f) => f.label);
      expect(labels).toContain('روش ثبت‌نام');
      expect(labels).toContain('نوع فروش');
      // And nothing from the other market's vocabulary.
      expect(labels).not.toContain('واگذاری');
      expect(detail.body.data.fields.find((f) => f.label === 'شرایط ثبت‌نام‌کننده').value).toBe(
        'کد ملی بدون سابقه'
      );
    });

    it('suspends a registration through the same endpoint, and the agency reads why', async () => {
      const owner = await agent();
      const viewer = await agent();
      const { cookie } = await staff();
      const made = await post(owner.cookie, capacity()).expect(201);
      const id = made.body.data.id;

      await request(app)
        .put(api(`/admin/havales/${id}/status`))
        .set('Cookie', cookie)
        .send({ status: 'SUSPENDED', reason: 'مبلغ امتیاز با بازار نمی‌خواند' })
        .expect(200);

      const market = await request(app)
        .get(api('/registrations?limit=50'))
        .set('Cookie', viewer.cookie)
        .expect(200);
      expect(market.body.data.items.some((r) => r.id === id)).toBe(false);

      const mine = await request(app)
        .get(api('/registrations/mine'))
        .set('Cookie', owner.cookie)
        .expect(200);
      expect(mine.body.data.items.find((r) => r.id === id).suspendReason).toContain('امتیاز');
    });

    it('counts only its own market in the header', async () => {
      const owner = await agent();
      const { cookie } = await staff();
      await post(owner.cookie, capacity()).expect(201);

      const [regDesk, allDesk] = await Promise.all([
        request(app).get(api('/admin/havales?market=REGISTRATION')).set('Cookie', cookie).expect(200),
        request(app).get(api('/admin/havales')).set('Cookie', cookie).expect(200),
      ]);

      expect(regDesk.body.data.summary.total).toBeGreaterThan(0);
      // Every حواله ever posted is in the unscoped count and in neither of the
      // scoped ones, which is the whole point of scoping the header.
      expect(allDesk.body.data.summary.total).toBeGreaterThan(regDesk.body.data.summary.total);
    });

    it('refuses a market nobody registered', async () => {
      const { cookie } = await staff();
      await request(app)
        .get(api('/admin/havales?market=QATAAT'))
        .set('Cookie', cookie)
        .expect(422);
    });
  });

  /**
   * The scheme name is the field an agency is most tempted to sign.
   *
   * It reads like a title, so «طرح ثبت‌نامی نمایندگی البرز — ۰۹۱۲…» looks to
   * the person typing it like naming their own product rather than publishing
   * a telephone number. It is published either way.
   */
  describe('contact details in the scheme name and the terms', () => {
    it('refuses a phone number in the scheme name', async () => {
      const { cookie } = await agent();
      const res = await post(cookie, capacity({ planName: 'طرح ویژه ۰۹۱۲۳۴۵۶۷۸۹' })).expect(422);
      expect(res.body.error.message).toContain('نام طرح');
    });

    it('refuses the agency’s own code in the scheme name', async () => {
      const signed = await agent();
      await post(signed.cookie, capacity({ planName: `طرح ${signed.user.agencyCode}` })).expect(422);
    });

    it('refuses a messenger handle in the terms', async () => {
      const { cookie } = await agent();
      const res = await post(cookie, capacity({ conditions: 'هماهنگی از @alborz_car' })).expect(422);
      expect(res.body.error.message).toContain('شرایط');
    });

    it('accepts a scheme name that is just a scheme name', async () => {
      const { cookie } = await agent();
      // The case that decides whether the rule helps or hurts: a real scheme
      // name is full of digits.
      await post(cookie, capacity({ planName: 'پیش‌فروش ۶ ماهه شهریور ۱۴۰۵' })).expect(201);
    });
  });
});
