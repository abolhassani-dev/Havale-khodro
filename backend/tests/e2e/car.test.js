const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const request = require('supertest');

const app = require('../../src/app');
const { prisma, connectDatabase, disconnectDatabase } = require('../../src/config/database');
const {
  api,
  PASSWORD,
  catalog,
  offer,
  signedInAgent,
  signIn,
  cleanup,
} = require('../helpers/factory');
const { UPLOADS_DIR } = require('../../src/modules/car/car.upload');
const { currentJalaliYear } = require('../../src/modules/car/car.constants');

/**
 * The خودرو market.
 *
 * Its own rules first — the body table and the grade it collapses into, the
 * catalogue-decided body shape, the year and the ranges — and then the two
 * architectural promises every market must keep: the reveal boundary (here
 * covering photos and description, not just the phone) and isolation from the
 * other markets' queries.
 *
 * Needs a database:  RUN_E2E=1 npm run test:e2e
 */
const maybe = process.env.RUN_E2E ? describe : describe.skip;

maybe('car market', () => {
  const created = [];
  let models = [];
  const YEAR = currentJalaliYear();

  const agent = async (overrides) => {
    const signed = await signedInAgent(overrides);
    created.push(signed.user.id);
    return signed;
  };

  const sale = (over = {}) => ({
    kind: 'OFFER',
    carModelId: models[0].id,
    year: YEAR - 1,
    mileageKm: 38000,
    carColor: 'سفید',
    warranty: true,
    carPriceToman: 1_140_000_000,
    bodyStatus: { 'fnd-f-d': 'PARTIAL', hood: 'PAINT' },
    ...over,
  });

  const wanted = (over = {}) => ({
    kind: 'REQUEST',
    carModelId: models[1].id,
    yearFrom: YEAR - 3,
    yearTo: YEAR,
    maxMileageKm: 60000,
    carPriceToman: 620_000_000,
    paintTolerance: 'MINOR_OK',
    ...over,
  });

  const post = (cookie, payload) =>
    request(app).post(api('/cars')).set('Cookie', cookie).send(payload);

  beforeAll(async () => {
    await connectDatabase();
    ({ models } = await catalog());
  });

  afterAll(async () => {
    await cleanup(created);
    await disconnectDatabase();
  });

  describe('posting a sale', () => {
    it('keeps the figures and derives the grade from the body table', async () => {
      const { cookie } = await agent();
      const res = await post(cookie, sale()).expect(201);

      expect(res.body.data.year).toBe(YEAR - 1);
      expect(res.body.data.mileageKm).toBe(38000);
      expect(res.body.data.carPriceToman).toBe(1_140_000_000);
      expect(res.body.data.bodyStatus).toEqual({ 'fnd-f-d': 'PARTIAL', hood: 'PAINT' });
      // Derived, never posted: a full panel of paint outranks the touch-up.
      expect(res.body.data.bodyGrade).toBe('PAINTED');
    });

    it('takes the body shape from the catalogue, not from the seller', async () => {
      const { cookie } = await agent();

      // Whatever the seller claims rides in extra fields and is stripped; the
      // stored shape is the catalogue's.
      const res = await post(cookie, { ...sale(), bodyType: 'PICKUP' }).expect(201);

      const model = await prisma.carModel.findUnique({
        where: { id: models[0].id },
        select: { bodyType: true },
      });
      expect(res.body.data.bodyType).toBe(model.bodyType || 'SEDAN');
    });

    it('refuses an unknown part rather than silently dropping it', async () => {
      const { cookie } = await agent();
      const res = await post(cookie, sale({ bodyStatus: { spoiler: 'PAINT' } })).expect(422);
      expect(JSON.stringify(res.body)).toMatch(/ناشناخته/);
    });

    it('refuses a condition the part class does not accept', async () => {
      const { cookie } = await agent();
      await post(cookie, sale({ bodyStatus: { 'chs-f-d': 'PARTIAL' } })).expect(422);
    });

    it('refuses a year in the future and a year before 1350', async () => {
      const { cookie } = await agent();
      await post(cookie, sale({ year: YEAR + 2 })).expect(422);
      await post(cookie, sale({ year: 1349 })).expect(422);
    });

    it('an empty table means «بدون رنگ»', async () => {
      const { cookie } = await agent();
      const res = await post(cookie, sale({ bodyStatus: undefined })).expect(201);
      expect(res.body.data.bodyGrade).toBe('NO_PAINT');
      expect(res.body.data.bodyStatus).toEqual({});
    });

    it('any brand is postable — this market has no brand restriction', async () => {
      // An agency with NO brand grants at all (the real-account default): the
      // حواله market refuses its offer, this market takes it — a finished car
      // on the lot is anybody's to sell.
      const { cookie } = await agent({ brands: [] });
      await request(app)
        .post(api('/havales'))
        .set('Cookie', cookie)
        .send(await offer())
        .expect(403);

      await post(cookie, sale()).expect(201);
    });
  });

  describe('posting a request', () => {
    it('keeps the ranges and the tolerance', async () => {
      const { cookie } = await agent();
      const res = await post(cookie, wanted()).expect(201);

      expect(res.body.data.yearFrom).toBe(YEAR - 3);
      expect(res.body.data.yearTo).toBe(YEAR);
      expect(res.body.data.maxMileageKm).toBe(60000);
      expect(res.body.data.paintTolerance).toBe('MINOR_OK');
    });

    it('refuses a backwards year range, and sale-only fields', async () => {
      const { cookie } = await agent();
      await post(cookie, wanted({ yearFrom: YEAR, yearTo: YEAR - 2 })).expect(422);
      await post(cookie, wanted({ mileageKm: 10 })).expect(422);
      await post(cookie, wanted({ bodyStatus: { hood: 'PAINT' } })).expect(422);
    });
  });

  describe('the reveal boundary', () => {
    it('hides identity, description and photos until the reveal — body stays public', async () => {
      const owner = await agent();
      const posted = await post(owner.cookie, sale({ description: 'فنی سالم، تخفیف پای معامله' }))
        .expect(201);
      const viewer = await agent();

      const card = await request(app)
        .get(api(`/cars/${posted.body.data.id}`))
        .set('Cookie', viewer.cookie)
        .expect(200);

      const d = card.body.data;
      // Public: the structured facts the market is searched by.
      expect(d.year).toBe(YEAR - 1);
      expect(d.bodyGrade).toBe('PAINTED');
      expect(d.bodyStatus).toEqual({ 'fnd-f-d': 'PARTIAL', hood: 'PAINT' });
      // Hidden: who, and everything a person typed or photographed.
      expect(d.agency).toBeNull();
      expect(d.contact).toBeNull();
      expect(d.description).toBeNull();
      expect(d.hasDescription).toBe(true);
      expect(d.photos).toEqual([]);
      // And nowhere in the whole payload does the owner's number appear.
      expect(JSON.stringify(card.body)).not.toContain(owner.user.coordinatorPhone.slice(-8));

      const reveal = await request(app)
        .post(api(`/cars/${posted.body.data.id}/reveal`))
        .set('Cookie', viewer.cookie)
        .expect(200);
      expect(reveal.body.data.contact.coordinatorPhone).toBe(owner.user.coordinatorPhone);

      const after = await request(app)
        .get(api(`/cars/${posted.body.data.id}`))
        .set('Cookie', viewer.cookie)
        .expect(200);
      expect(after.body.data.description).toBe('فنی سالم، تخفیف پای معامله');
      expect(after.body.data.contactRevealed).toBe(true);
    });

    it('shares the one allowance with the other markets', async () => {
      const owner = await agent();
      const posted = await post(owner.cookie, sale()).expect(201);
      const viewer = await agent();

      const before = await request(app)
        .get(api('/havales/reveal-usage'))
        .set('Cookie', viewer.cookie)
        .expect(200);

      await request(app)
        .post(api(`/cars/${posted.body.data.id}/reveal`))
        .set('Cookie', viewer.cookie)
        .expect(200);

      const after = await request(app)
        .get(api('/havales/reveal-usage'))
        .set('Cookie', viewer.cookie)
        .expect(200);
      expect(after.body.data.dailyUsed).toBe(before.body.data.dailyUsed + 1);
    });

    it('refuses a phone number typed into the description', async () => {
      const { cookie } = await agent();
      await post(cookie, sale({ description: 'تماس: ۰۹۱۲۳۴۵۶۷۸۹' })).expect(422);
    });
  });

  describe('photos', () => {
    // The smallest real PNG there is — enough for multer's type check, which
    // reads the multipart Content-Type, and for sendFile to have bytes.
    const PNG = Buffer.from(
      '89504e470d0a1a0a0000000d4948445200000001000000010806000000' +
        '1f15c4890000000d49444154789c626001000000ffff03000006000557' +
        'bfabd40000000049454e44ae426082',
      'hex'
    );

    const attach = (req, count) => {
      for (let i = 0; i < count; i += 1) req.attach('photos', PNG, `car-${i}.png`);
      return req;
    };

    it('serves a photo to the owner, an admin, and a paid viewer — nobody else', async () => {
      const owner = await agent();
      const posted = await post(owner.cookie, sale()).expect(201);
      const id = posted.body.data.id;

      const uploaded = await attach(
        request(app).post(api(`/cars/${id}/photos`)).set('Cookie', owner.cookie),
        2
      ).expect(200);
      expect(uploaded.body.data.photoCount).toBe(2);
      // Adding photos changes what past revealers paid to evaluate.
      expect(uploaded.body.data.editCount).toBe(1);

      const url = uploaded.body.data.photos[0].url.replace('/api/v1', '');

      // The owner reads its own file.
      await request(app).get(api(url)).set('Cookie', owner.cookie).expect(200);

      // A stranger gets nothing — and the card shows a count, not the files.
      const viewer = await agent();
      const card = await request(app).get(api(`/cars/${id}`)).set('Cookie', viewer.cookie);
      expect(card.body.data.photos).toEqual([]);
      expect(card.body.data.photoCount).toBe(2);
      await request(app).get(api(url)).set('Cookie', viewer.cookie).expect(404);

      // After the reveal, the same request answers.
      await request(app).post(api(`/cars/${id}/reveal`)).set('Cookie', viewer.cookie).expect(200);
      const opened = await request(app).get(api(url)).set('Cookie', viewer.cookie).expect(200);
      expect(opened.headers['content-type']).toContain('image/png');

      // Moderation sees what was reported.
      const tag = `${Date.now()}${Math.floor(Math.random() * 999)}`;
      const adminUser = await prisma.user.create({
        data: {
          username: `test_admin_${tag}`,
          passwordHash: await bcrypt.hash(PASSWORD, 4),
          phone: `0919${tag.slice(-7)}`,
          fullName: 'کارمند تست',
          role: 'SUPER_ADMIN',
          mustChangePassword: false,
        },
      });
      created.push(adminUser.id);
      await request(app).get(api(url)).set('Cookie', await signIn(adminUser)).expect(200);
    });

    it('refuses the seventh photo, a photo on a request, and a stranger uploading', async () => {
      const owner = await agent();
      const posted = await post(owner.cookie, sale()).expect(201);
      const id = posted.body.data.id;

      await attach(request(app).post(api(`/cars/${id}/photos`)).set('Cookie', owner.cookie), 6)
        .expect(200);
      await attach(request(app).post(api(`/cars/${id}/photos`)).set('Cookie', owner.cookie), 1)
        .expect(400);

      const req = await post(owner.cookie, wanted()).expect(201);
      await attach(
        request(app).post(api(`/cars/${req.body.data.id}/photos`)).set('Cookie', owner.cookie),
        1
      ).expect(400);

      const stranger = await agent();
      await attach(request(app).post(api(`/cars/${id}/photos`)).set('Cookie', stranger.cookie), 1)
        .expect(404);
    });

    it('removing a photo deletes the row and the file', async () => {
      const owner = await agent();
      const posted = await post(owner.cookie, sale()).expect(201);
      const id = posted.body.data.id;

      const uploaded = await attach(
        request(app).post(api(`/cars/${id}/photos`)).set('Cookie', owner.cookie),
        1
      ).expect(200);
      const photo = uploaded.body.data.photos[0];
      const fileName = photo.url.split('/').pop();
      expect(fs.existsSync(path.join(UPLOADS_DIR, fileName))).toBe(true);

      const after = await request(app)
        .delete(api(`/cars/photos/${photo.id}`))
        .set('Cookie', owner.cookie)
        .expect(200);
      expect(after.body.data.photoCount).toBe(0);
      // The unlink is fire-and-forget; give it a beat.
      await new Promise((r) => setTimeout(r, 100));
      expect(fs.existsSync(path.join(UPLOADS_DIR, fileName))).toBe(false);
    });

    it('refuses a name this system never wrote — traversal has no address', async () => {
      const { cookie } = await agent();
      await request(app)
        .get(api('/cars/photos/..%2F..%2F.env'))
        .set('Cookie', cookie)
        .expect(422);
    });
  });

  describe('market isolation', () => {
    it('keeps a car out of the حواله and ثبت‌نامی lists, and their ids apart', async () => {
      const owner = await agent();
      const posted = await post(owner.cookie, sale()).expect(201);
      const viewer = await agent();

      for (const path of ['/havales', '/registrations']) {
        const list = await request(app).get(api(path)).set('Cookie', viewer.cookie).expect(200);
        expect(list.body.data.items.some((r) => r.id === posted.body.data.id)).toBe(false);
      }
      await request(app)
        .get(api(`/registrations/${posted.body.data.id}`))
        .set('Cookie', viewer.cookie)
        .expect(404);
    });
  });

  describe('searching', () => {
    it('filters by body grade, year range and price range', async () => {
      const owner = await agent();
      const clean = await post(owner.cookie, sale({ bodyStatus: undefined })).expect(201);
      const damaged = await post(
        owner.cookie,
        sale({ bodyStatus: { 'chs-f-d': 'DAMAGE' }, carPriceToman: 2_000_000_000, year: YEAR - 5 })
      ).expect(201);
      const viewer = await agent();

      const noPaint = await request(app)
        .get(api('/cars?grades=NO_PAINT'))
        .set('Cookie', viewer.cookie)
        .expect(200);
      const ids = noPaint.body.data.items.map((r) => r.id);
      expect(ids).toContain(clean.body.data.id);
      expect(ids).not.toContain(damaged.body.data.id);

      const chassisOk = await request(app)
        .get(api('/cars?grades=NO_PAINT,MINOR_PAINT,PAINTED,REPLACED'))
        .set('Cookie', viewer.cookie)
        .expect(200);
      expect(chassisOk.body.data.items.map((r) => r.id)).not.toContain(damaged.body.data.id);

      // «رنگ‌شده + شاسی‌خورده» in one search — the combination is the point.
      const combo = await request(app)
        .get(api('/cars?grades=PAINTED,CHASSIS_DAMAGED'))
        .set('Cookie', viewer.cookie)
        .expect(200);
      const comboIds = combo.body.data.items.map((r) => r.id);
      expect(comboIds).toContain(damaged.body.data.id);
      expect(comboIds).not.toContain(clean.body.data.id);

      await request(app).get(api('/cars?grades=SHINY')).set('Cookie', viewer.cookie).expect(422);

      const recent = await request(app)
        .get(api(`/cars?yearFrom=${YEAR - 2}`))
        .set('Cookie', viewer.cookie)
        .expect(200);
      const recentIds = recent.body.data.items.map((r) => r.id);
      expect(recentIds).toContain(clean.body.data.id);
      expect(recentIds).not.toContain(damaged.body.data.id);

      const cheap = await request(app)
        .get(api('/cars?priceTo=1500000000'))
        .set('Cookie', viewer.cookie)
        .expect(200);
      expect(cheap.body.data.items.map((r) => r.id)).not.toContain(damaged.body.data.id);

      await request(app).get(api('/cars?page=51')).set('Cookie', viewer.cookie).expect(422);
    });

    it('a request has no body: it carries no grade and never answers a body filter', async () => {
      const owner = await agent();
      const req = await post(owner.cookie, wanted()).expect(201);
      // The column defaults to NO_PAINT; the API must not let that read as a
      // verdict on a car nobody has seen.
      expect(req.body.data.bodyGrade).toBeNull();
      expect(req.body.data.bodyStatus).toEqual({});

      const viewer = await agent();
      const all = await request(app).get(api('/cars')).set('Cookie', viewer.cookie).expect(200);
      expect(all.body.data.items.map((r) => r.id)).toContain(req.body.data.id);

      for (const body of ['NO_PAINT', 'NO_PAINT,MINOR_PAINT,PAINTED', 'PAINTED,CHASSIS_DAMAGED']) {
        const res = await request(app)
          .get(api(`/cars?grades=${body}`))
          .set('Cookie', viewer.cookie)
          .expect(200);
        expect(res.body.data.items.map((r) => r.id)).not.toContain(req.body.data.id);
        expect(res.body.data.items.every((r) => r.kind === 'OFFER')).toBe(true);
      }
    });

    it('a sale says whether the warranty is live, and the filter finds it', async () => {
      const owner = await agent();
      await post(owner.cookie, sale({ warranty: undefined })).expect(422);
      await post(owner.cookie, wanted({ warranty: true })).expect(422);
      const live = await post(owner.cookie, sale({ warranty: true })).expect(201);
      const dead = await post(owner.cookie, sale({ warranty: false })).expect(201);
      expect(live.body.data.warranty).toBe(true);
      expect(dead.body.data.warranty).toBe(false);

      const viewer = await agent();
      const res = await request(app)
        .get(api('/cars?warranty=1'))
        .set('Cookie', viewer.cookie)
        .expect(200);
      const ids = res.body.data.items.map((r) => r.id);
      expect(ids).toContain(live.body.data.id);
      expect(ids).not.toContain(dead.body.data.id);
      expect(res.body.data.items.every((r) => r.kind === 'OFFER')).toBe(true);
    });

    it('body type takes several shapes at once', async () => {
      const viewer = await agent();
      const res = await request(app)
        .get(api('/cars?bodyType=SEDAN,HATCHBACK'))
        .set('Cookie', viewer.cookie)
        .expect(200);
      expect(res.body.data.items.every((r) => ['SEDAN', 'HATCHBACK'].includes(r.bodyType))).toBe(true);
      await request(app).get(api('/cars?bodyType=SEDAN,BOAT')).set('Cookie', viewer.cookie).expect(422);
    });

    /**
     * The order is a product decision, so it is asserted as one.
     *
     * Cheapest-first is the sort a car market lives on, and the thing that
     * quietly breaks it is a NULL: a purchase request carries no price, and
     * without «nulls last» every one of them would sit above the cheapest
     * car on the page.
     */
    it('orders by price and by mileage, and refuses a word it does not know', async () => {
      const seller = await agent();
      await post(seller.cookie, sale({ carPriceToman: 990_000_000, mileageKm: 120000 })).expect(201);
      await post(seller.cookie, sale({ carPriceToman: 2_400_000_000, mileageKm: 5000 })).expect(201);
      await post(seller.cookie, wanted({ carPriceToman: null })).expect(201);

      const viewer = await agent();
      const cheap = await request(app).get(api('/cars?sort=cheap')).set('Cookie', viewer.cookie).expect(200);
      const prices = cheap.body.data.items.map((r) => r.carPriceToman).filter((p) => p !== null);
      expect([...prices].sort((a, b) => a - b)).toEqual(prices);
      const firstNull = cheap.body.data.items.findIndex((r) => r.carPriceToman === null);
      if (firstNull !== -1) {
        expect(cheap.body.data.items.slice(firstNull).every((r) => r.carPriceToman === null)).toBe(true);
      }

      const km = await request(app).get(api('/cars?sort=km&kind=OFFER')).set('Cookie', viewer.cookie).expect(200);
      const driven = km.body.data.items.map((r) => r.mileageKm);
      expect([...driven].sort((a, b) => a - b)).toEqual(driven);

      await request(app).get(api('/cars?sort=cheapest')).set('Cookie', viewer.cookie).expect(422);
    });
  });

  describe('the owner’s side', () => {
    it('edits move the grade with the table, and are marked', async () => {
      const owner = await agent();
      const posted = await post(owner.cookie, sale()).expect(201);

      const updated = await request(app)
        .patch(api(`/cars/${posted.body.data.id}`))
        .set('Cookie', owner.cookie)
        .send({ bodyStatus: { 'rl-f-d': 'REPLACE' }, carPriceToman: 1_200_000_000 })
        .expect(200);

      expect(updated.body.data.bodyGrade).toBe('CHASSIS_DAMAGED');
      expect(updated.body.data.carPriceToman).toBe(1_200_000_000);
      expect(updated.body.data.editCount).toBe(1);
    });

    it('sells, renews and removes like its siblings', async () => {
      const owner = await agent();
      const posted = await post(owner.cookie, sale()).expect(201);
      const id = posted.body.data.id;

      await request(app).post(api(`/cars/${id}/renew`)).set('Cookie', owner.cookie).expect(200);
      const sold = await request(app)
        .post(api(`/cars/${id}/fulfill`))
        .set('Cookie', owner.cookie)
        .expect(200);
      expect(sold.body.data.status).toBe('FULFILLED');

      await request(app).delete(api(`/cars/${id}`)).set('Cookie', owner.cookie).expect(200);
      const gone = await request(app).get(api(`/cars/${id}`)).set('Cookie', owner.cookie).expect(404);
      // The refusal is read by an agency, so it is written in Persian. The
      // message used to be built as `${noun} not found`, which put «آگهی خودرو
      // not found» in a toast in front of them.
      expect(gone.body.error.message).toBe('آگهی خودرو پیدا نشد');
      expect(gone.body.error.message).not.toMatch(/[A-Za-z]/);
    });

    it('lists its own with numbered pages', async () => {
      const owner = await agent();
      for (let i = 0; i < 3; i += 1) await post(owner.cookie, sale()).expect(201);

      const page1 = await request(app)
        .get(api('/cars/mine?page=1&limit=2'))
        .set('Cookie', owner.cookie)
        .expect(200);
      expect(page1.body.data.items).toHaveLength(2);
      expect(page1.body.data.total).toBe(3);
      expect(page1.body.data.pages).toBe(2);
    });
  });
});
