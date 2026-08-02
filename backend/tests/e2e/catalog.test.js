const request = require('supertest');

const app = require('../../src/app');
const { prisma, connectDatabase, disconnectDatabase } = require('../../src/config/database');
const { api, offer, catalog, signedInAgent, cleanup } = require('../helpers/factory');

/**
 * The car catalogue: a closed list the operator edits, and the snapshot rule
 * that keeps old listings readable when they edit it.
 *
 * Needs a database:  RUN_E2E=1 npm run test:e2e
 */
const maybe = process.env.RUN_E2E ? describe : describe.skip;

maybe('catalog', () => {
  const created = [];

  const agent = async (overrides) => {
    const signed = await signedInAgent(overrides);
    created.push(signed.user.id);
    return signed;
  };

  beforeAll(async () => {
    await connectDatabase();
    await catalog();
  });

  afterAll(async () => {
    await cleanup(created);
    await disconnectDatabase();
  });

  it('serves the company, brand and model tree', async () => {
    const { cookie } = await agent();

    const res = await request(app).get(api('/catalog')).set('Cookie', cookie).expect(200);

    const modiran = res.body.data.companies.find((c) => c.slug === 'modiran-khodro');
    expect(modiran).toBeDefined();
    expect(modiran.brands.map((b) => b.slug).sort()).toEqual(['fownix', 'mvm', 'xtrim']);

    const fownix = modiran.brands.find((b) => b.slug === 'fownix');
    expect(fownix.models.length).toBeGreaterThan(5);
    expect(res.body.data.colors.length).toBeGreaterThan(5);
  });

  it('fills the car name and supplying company from the catalogue, not the client', async () => {
    const { cookie } = await agent();
    const payload = await offer();

    const res = await request(app)
      .post(api('/havales'))
      .set('Cookie', cookie)
      // A client trying to name a different company is simply ignored: the
      // supplier is derived from the chosen model, so a listing cannot claim a
      // Fownix is built by somebody else.
      .send({ ...payload, carType: 'هرچه دلم بخواهد', supplierCompany: 'شرکت جعلی' })
      .expect(201);

    const model = await prisma.carModel.findUnique({ where: { id: payload.carModelId } });
    expect(res.body.data.carType).toBe(model.name);
    expect(res.body.data.supplierCompany).toBe('مدیران خودرو');
  });

  it('refuses a model or colour that is not on the list', async () => {
    const { cookie } = await agent();
    const payload = await offer();

    await request(app)
      .post(api('/havales'))
      .set('Cookie', cookie)
      .send({ ...payload, carModelId: 'clnotarealmodelid00000' })
      .expect(400);

    await request(app)
      .post(api('/havales'))
      .set('Cookie', cookie)
      .send({ ...payload, carColor: 'بنفش شبرنگ' })
      .expect(400);
  });

  it('leaves existing listings alone when a model is renamed', async () => {
    const { cookie } = await agent();

    const model = await prisma.carModel.create({
      data: {
        name: 'test_مدل موقت',
        brandId: (await prisma.carBrand.findFirst({ where: { slug: 'mvm' } })).id,
      },
    });

    const res = await request(app)
      .post(api('/havales'))
      .set('Cookie', cookie)
      .send(await offer({ carModelId: model.id }))
      .expect(201);

    await prisma.carModel.update({ where: { id: model.id }, data: { name: 'test_اسم عوض شد' } });

    const after = await request(app)
      .get(api(`/havales/${res.body.data.id}`))
      .set('Cookie', cookie)
      .expect(200);

    // The listing keeps saying what it said when it was posted. Otherwise a
    // correction to the catalogue would silently rewrite what every old listing
    // advertised — including the ones with violation reports filed against them.
    expect(after.body.data.carType).toBe('test_مدل موقت');

    await prisma.havale.deleteMany({ where: { carModelId: model.id } });
    await prisma.carModel.delete({ where: { id: model.id } });
  });

  it('stops new listings on a retired model without breaking the old ones', async () => {
    const { cookie } = await agent();

    const model = await prisma.carModel.create({
      data: {
        name: 'test_مدل بازنشسته',
        brandId: (await prisma.carBrand.findFirst({ where: { slug: 'mvm' } })).id,
      },
    });

    const existing = await request(app)
      .post(api('/havales'))
      .set('Cookie', cookie)
      .send(await offer({ carModelId: model.id }))
      .expect(201);

    await prisma.carModel.update({ where: { id: model.id }, data: { isActive: false } });

    await request(app)
      .post(api('/havales'))
      .set('Cookie', cookie)
      .send(await offer({ carModelId: model.id }))
      .expect(400);

    // Retiring a model must not take down the listings already posted with it.
    await request(app)
      .get(api(`/havales/${existing.body.data.id}`))
      .set('Cookie', cookie)
      .expect(200);

    await prisma.havale.deleteMany({ where: { carModelId: model.id } });
    await prisma.carModel.delete({ where: { id: model.id } });
  });

  it('filters listings by brand', async () => {
    const owner = await agent();
    const payload = await offer();
    await request(app).post(api('/havales')).set('Cookie', owner.cookie).send(payload).expect(201);

    const model = await prisma.carModel.findUnique({
      where: { id: payload.carModelId },
      select: { brandId: true },
    });

    const res = await request(app)
      .get(api('/havales'))
      .query({ brandId: model.brandId })
      .set('Cookie', owner.cookie)
      .expect(200);

    expect(res.body.data.items.length).toBeGreaterThan(0);
  });
});
