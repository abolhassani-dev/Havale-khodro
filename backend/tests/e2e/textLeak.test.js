const request = require('supertest');

const app = require('../../src/app');
const { prisma, connectDatabase, disconnectDatabase } = require('../../src/config/database');
const { api, offer, catalog, signedInAgent, cleanup } = require('../helpers/factory');
const { looksLikePhone, normalise } = require('../../src/utils/textGuard');

/**
 * Nothing an agency types reaches another agency carrying a telephone number.
 *
 * This suite exists because the first three holes in that rule were found by
 * the owner, one at a time, in production — a number written «۰۰۹۸…» rather
 * than «۰۹۱۲…», a box called «موعد تحویل» that nobody had thought to guard, and
 * a model-year field that was twenty characters of free text. Each was fixed as
 * it was reported, which is exactly the wrong shape of work: the next field
 * somebody adds will be unguarded too, and it will be found the same way.
 *
 * So these tests do not name the fields. They read every text column off the
 * row the API actually stored, write a telephone number into every one of them,
 * and then assert that nothing phone-shaped survives serialisation to a viewer
 * who has not paid for the contact.
 *
 * **A new text field is covered the day it is added.** If it is not masked,
 * this suite goes red without anybody editing it.
 *
 * Needs a database:  RUN_E2E=1 npm run test:e2e
 */
const maybe = process.env.RUN_E2E ? describe : describe.skip;

const PHONE = '۰۹۱۲۳۴۵۶۷۸۹';

/**
 * Every string this row would show a reader, wherever it sits in the payload.
 *
 * Walked rather than listed, for the same reason as everything else here: a
 * field added to the DTO next year is walked too.
 */
function stringsIn(value, path = '', found = []) {
  if (typeof value === 'string') found.push([path, value]);
  else if (Array.isArray(value)) value.forEach((v, i) => stringsIn(v, `${path}[${i}]`, found));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) stringsIn(v, path ? `${path}.${k}` : k, found);
  }
  return found;
}

maybe('no free text carries a contact out', () => {
  const created = [];

  const agent = async (overrides) => {
    const signed = await signedInAgent(overrides);
    created.push(signed.user.id);
    return signed;
  };

  let models = [];

  beforeAll(async () => {
    await connectDatabase();
    ({ models } = await catalog());
  });

  afterAll(async () => {
    await cleanup(created);
    await disconnectDatabase();
  });

  /**
   * Writes the number into every text column of a stored row, straight past the
   * API.
   *
   * Straight past on purpose: the submit check is tested elsewhere, and what is
   * under test here is the layer beneath it — the rows that predate the check,
   * and whatever encoding walks past it tomorrow. Which columns exist is read
   * from the record itself.
   */
  async function poison(model, where) {
    const row = await prisma[model].findUnique({ where });
    const data = {};

    for (const [key, value] of Object.entries(row)) {
      // Only the columns that hold prose. Ids and enums are not free text, and
      // writing a phone number into one would test the database, not the rule.
      if (typeof value !== 'string') continue;
      if (key === 'id' || key.endsWith('Id') || key === 'status' || key === 'market') continue;
      if (key === 'kind' || key === 'solh' || key === 'paymentType' || key === 'method') continue;
      if (key === 'saleType' || key === 'bodyType' || key === 'bodyGrade') continue;
      if (key === 'paintTolerance') continue;
      data[key] = PHONE;
    }

    if (Object.keys(data).length) await prisma[model].update({ where, data });
    return Object.keys(data);
  }

  /** Anything phone-shaped anywhere in the payload, with the path to it. */
  function leaks(payload) {
    return stringsIn(payload).filter(([, text]) => looksLikePhone(normalise(text)));
  }

  it('a حواله shows nothing phone-shaped to a viewer who has not paid', async () => {
    const owner = await agent();
    const viewer = await agent();

    const posted = await request(app)
      .post(api('/havales'))
      .set('Cookie', owner.cookie)
      .send(await offer())
      .expect(201);

    const poisoned = await poison('listing', { id: posted.body.data.id });
    // If this ever finds nothing to poison, the test is passing on an empty
    // set and proving nothing.
    expect(poisoned.length).toBeGreaterThan(0);

    const one = await request(app)
      .get(api(`/havales/${posted.body.data.id}`))
      .set('Cookie', viewer.cookie)
      .expect(200);

    expect(leaks(one.body.data)).toEqual([]);
  });

  it('a ثبت‌نامی shows nothing phone-shaped, in the listing or in its own columns', async () => {
    const owner = await agent();
    const viewer = await agent();

    const posted = await request(app)
      .post(api('/registrations'))
      .set('Cookie', owner.cookie)
      .send({
        kind: 'OFFER',
        carModelId: models[0].id,
        planName: 'پیش‌فروش شهریور ۱۴۰۵',
        method: 'LOTTERY',
        saleType: 'PRESALE',
        capacity: 4,
        depositToman: 550_000_000,
        premiumToman: 180_000_000,
      })
      .expect(201);

    // Both halves: the shared listing row and the market's own detail table.
    // The field that leaked in production — «موعد تحویل» — lives in the second.
    const onListing = await poison('listing', { id: posted.body.data.id });
    const onDetail = await poison('registrationDetail', { listingId: posted.body.data.id });
    expect(onListing.length).toBeGreaterThan(0);
    expect(onDetail.length).toBeGreaterThan(0);

    const one = await request(app)
      .get(api(`/registrations/${posted.body.data.id}`))
      .set('Cookie', viewer.cookie)
      .expect(200);

    expect(leaks(one.body.data)).toEqual([]);
  });

  it('a خودرو shows nothing phone-shaped — and its detail table holds no prose at all', async () => {
    const owner = await agent();
    const viewer = await agent();

    const posted = await request(app)
      .post(api('/cars'))
      .set('Cookie', owner.cookie)
      .send({
        kind: 'OFFER',
        carModelId: models[0].id,
        year: 1404,
        mileageKm: 12000,
        carColor: 'سفید',
        warranty: false,
        carPriceToman: 985_000_000,
        bodyStatus: { hood: 'PAINT' },
      })
      .expect(201);

    const onListing = await poison('listing', { id: posted.body.data.id });
    expect(onListing.length).toBeGreaterThan(0);

    // This market's own table is all numbers, enums and a JSON of chips — no
    // prose columns by design, which this asserts so a future free-text column
    // announces itself here instead of shipping unguarded.
    const onDetail = await poison('carDetail', { listingId: posted.body.data.id });
    expect(onDetail).toEqual([]);

    const one = await request(app)
      .get(api(`/cars/${posted.body.data.id}`))
      .set('Cookie', viewer.cookie)
      .expect(200);

    expect(leaks(one.body.data)).toEqual([]);
  });

  it('and nothing phone-shaped in the public list either', async () => {
    const owner = await agent();
    const viewer = await agent();

    const posted = await request(app)
      .post(api('/havales'))
      .set('Cookie', owner.cookie)
      .send(await offer())
      .expect(201);

    await poison('listing', { id: posted.body.data.id });

    // The detail endpoint and the list are two different serialisers, and only
    // one of them was masked the first time somebody wrote one of these.
    const list = await request(app)
      .get(api(`/havales?carType=${encodeURIComponent(posted.body.data.carType)}`))
      .set('Cookie', viewer.cookie)
      .expect(200);

    expect(leaks(list.body.data)).toEqual([]);
  });

  /**
   * The rule that ends the argument rather than winning it.
   *
   * Every check above is about a number *getting past* a filter. These two are
   * about there being no filter to get past: the typed boxes are not on a
   * public card at all, so there is nothing to encode into — and they arrive,
   * whole, the moment somebody pays for the contact.
   */
  describe('typed text is behind the reveal, not behind a filter', () => {
    it('a حواله card carries no description until it is paid for', async () => {
      const owner = await agent();
      const viewer = await agent();

      const posted = await request(app)
        .post(api('/havales'))
        .set('Cookie', owner.cookie)
        .send({ ...(await offer()), description: 'رنگ بدون خط و خش، تحویل فوری' })
        .expect(201);

      const before = await request(app)
        .get(api(`/havales/${posted.body.data.id}`))
        .set('Cookie', viewer.cookie)
        .expect(200);
      expect(before.body.data.description).toBeNull();
      // Said, not hidden: «there is a note here» is itself a reason to pay.
      expect(before.body.data.hasDescription).toBe(true);

      await request(app)
        .post(api(`/havales/${posted.body.data.id}/reveal`))
        .set('Cookie', viewer.cookie)
        .expect(200);

      const after = await request(app)
        .get(api(`/havales/${posted.body.data.id}`))
        .set('Cookie', viewer.cookie)
        .expect(200);
      expect(after.body.data.description).toBe('رنگ بدون خط و خش، تحویل فوری');
    });

    it('a ثبت‌نامی card carries none of its four typed boxes until it is paid for', async () => {
      const owner = await agent();
      const viewer = await agent();

      const posted = await request(app)
        .post(api('/registrations'))
        .set('Cookie', owner.cookie)
        .send({
          kind: 'OFFER',
          carModelId: models[0].id,
          planName: 'پیش‌فروش شهریور ۱۴۰۵',
          method: 'LOTTERY',
          saleType: 'PRESALE',
          capacity: 4,
          depositToman: 550_000_000,
          premiumToman: 180_000_000,
          deliveryEstimate: 'اسفند ۱۴۰۵',
          conditions: 'کارت ملی و شناسنامه',
          description: 'ظرفیت محدود',
        })
        .expect(201);

      const before = await request(app)
        .get(api(`/registrations/${posted.body.data.id}`))
        .set('Cookie', viewer.cookie)
        .expect(200);

      for (const field of ['planName', 'deliveryEstimate', 'conditions', 'description']) {
        expect(before.body.data[field]).toBeNull();
      }
      expect(before.body.data.hasNotes).toBe(true);
      // What stays is everything the market is searched by, and all of it is
      // structured — a card with nothing on it would be worse than the leak.
      expect(before.body.data.method).toBe('LOTTERY');
      expect(before.body.data.capacity).toBe(4);
      expect(before.body.data.premiumToman).toBe(180_000_000);

      await request(app)
        .post(api(`/registrations/${posted.body.data.id}/reveal`))
        .set('Cookie', viewer.cookie)
        .expect(200);

      const after = await request(app)
        .get(api(`/registrations/${posted.body.data.id}`))
        .set('Cookie', viewer.cookie)
        .expect(200);
      expect(after.body.data.planName).toBe('پیش‌فروش شهریور ۱۴۰۵');
      expect(after.body.data.deliveryEstimate).toBe('اسفند ۱۴۰۵');
      expect(after.body.data.conditions).toBe('کارت ملی و شناسنامه');
      expect(after.body.data.description).toBe('ظرفیت محدود');
    });

    it('the owner keeps their own words, paid for or not', async () => {
      const owner = await agent();
      const posted = await request(app)
        .post(api('/havales'))
        .set('Cookie', owner.cookie)
        .send({ ...(await offer()), description: 'متن خودم' })
        .expect(201);

      const mine = await request(app)
        .get(api('/havales/mine'))
        .set('Cookie', owner.cookie)
        .expect(200);

      const row = mine.body.data.items.find((h) => h.id === posted.body.data.id);
      expect(row.description).toBe('متن خودم');
    });
  });

  /**
   * Every box on both forms, refused at submit.
   *
   * The table is written out because a refusal has to name the box, and the
   * name is the thing being asserted. But it is a second line of defence: the
   * tests above hold whether or not this one does.
   */
  describe('refused at the door', () => {
    const havaleFields = ['description', 'model'];
    const regFields = ['planName', 'conditions', 'deliveryEstimate', 'description'];

    it.each(havaleFields)('حواله — «%s» will not take a phone number', async (field) => {
      const { cookie } = await agent();
      await request(app)
        .post(api('/havales'))
        .set('Cookie', cookie)
        .send({ ...(await offer()), [field]: PHONE })
        .expect(422);
    });

    it.each(regFields)('ثبت‌نامی — «%s» will not take a phone number', async (field) => {
      const { cookie } = await agent();
      await request(app)
        .post(api('/registrations'))
        .set('Cookie', cookie)
        .send({
          kind: 'OFFER',
          carModelId: models[0].id,
          planName: 'پیش‌فروش شهریور ۱۴۰۵',
          method: 'LOTTERY',
          saleType: 'PRESALE',
          capacity: 4,
          depositToman: 550_000_000,
          premiumToman: 180_000_000,
          [field]: PHONE,
        })
        .expect(422);
    });
  });
});
