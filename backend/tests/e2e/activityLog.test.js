const bcrypt = require('bcryptjs');
const request = require('supertest');

const app = require('../../src/app');
const { prisma, connectDatabase, disconnectDatabase } = require('../../src/config/database');
const {
  api,
  PASSWORD,
  catalog,
  offer,
  signIn,
  signedInAgent,
  cleanup,
} = require('../helpers/factory');

/**
 * The audit trail, as something you can actually use.
 *
 * Three things are checked here, and each one was a real hole:
 *
 *   - an edit used to record the word «ویرایش کرد» and nothing else, so the
 *     one question an argument is ever about — what was the number before? —
 *     had no answer anywhere in the system;
 *   - only the login controller recorded an address, because it is the only
 *     place with `req` in scope, so the panel showed «IP: —» on almost
 *     every row;
 *   - the only way to find anything was to page through it.
 *
 * Needs a database:  RUN_E2E=1 npm run test:e2e
 */
const maybe = process.env.RUN_E2E ? describe : describe.skip;

maybe('the activity log', () => {
  const created = [];
  let models = [];

  const agent = async (overrides) => {
    const signed = await signedInAgent(overrides);
    created.push(signed.user.id);
    return signed;
  };

  const staff = async (role = 'SUPER_ADMIN') => {
    const tag = `${Date.now()}${Math.floor(Math.random() * 999)}`;
    const user = await prisma.user.create({
      data: {
        username: `test_log_${role.toLowerCase()}_${tag}`,
        passwordHash: await bcrypt.hash(PASSWORD, 4),
        phone: `0918${tag.slice(-7)}`,
        fullName: 'کارمند تست',
        role,
        mustChangePassword: false,
      },
    });
    created.push(user.id);
    return { user, cookie: await signIn(user) };
  };

  /** The most recent log row for an action, straight from the table. */
  const lastEntry = (userId, action) =>
    prisma.activityLog.findFirst({ where: { userId, action }, orderBy: { createdAt: 'desc' } });

  beforeAll(async () => {
    await connectDatabase();
    ({ models } = await catalog());
  });

  afterAll(async () => {
    await cleanup(created);
    await disconnectDatabase();
  });

  describe('what an edit changed', () => {
    it('records the old value and the new one, with a Persian label', async () => {
      const owner = await agent();
      const listing = await request(app)
        .post(api('/havales'))
        .set('Cookie', owner.cookie)
        .send(await offer({ amountToman: 50_000_000, carPriceToman: 60_000_000, paidAmountToman: 20_000_000 }))
        .expect(201);

      await request(app)
        .patch(api(`/havales/${listing.body.data.id}`))
        .set('Cookie', owner.cookie)
        .send({ amountToman: 80_000_000 })
        .expect(200);

      const entry = await lastEntry(owner.user.id, 'HAVALE_UPDATED');
      expect(entry.changes).toEqual([
        {
          field: 'amountToman',
          label: 'مبلغ حواله',
          kind: 'money',
          from: 50_000_000,
          to: 80_000_000,
        },
      ]);
    });

    it('writes no diff at all when the edit changed nothing', async () => {
      const owner = await agent();
      const body = await offer({ amountToman: 50_000_000, carPriceToman: 60_000_000, paidAmountToman: 20_000_000 });
      const listing = await request(app)
        .post(api('/havales'))
        .set('Cookie', owner.cookie)
        .send(body)
        .expect(201);

      await request(app)
        .patch(api(`/havales/${listing.body.data.id}`))
        .set('Cookie', owner.cookie)
        .send({ amountToman: 50_000_000 })
        .expect(200);

      const entry = await lastEntry(owner.user.id, 'HAVALE_UPDATED');
      expect(entry.changes).toBeNull();
    });

    it('refuses to change the car an existing listing is about', async () => {
      const owner = await agent();
      const listing = await request(app)
        .post(api('/havales'))
        .set('Cookie', owner.cookie)
        .send(await offer())
        .expect(201);

      // The car is what the advertisement *is*. Letting it move would keep the
      // row's age, its position and its view count while changing what is for
      // sale — and would silently rewrite what everybody who already paid to
      // see the contact had been looking at.
      await request(app)
        .patch(api(`/havales/${listing.body.data.id}`))
        .set('Cookie', owner.cookie)
        .send({ carModelId: models[1].id })
        .expect(422);
    });

    it('marks the listing as edited, and says so only after a real edit', async () => {
      const owner = await agent();
      const listing = await request(app)
        .post(api('/havales'))
        .set('Cookie', owner.cookie)
        .send(await offer())
        .expect(201);

      const fresh = await prisma.listing.findUnique({ where: { id: listing.body.data.id } });
      expect(fresh.editedAt).toBeNull();
      expect(fresh.editCount).toBe(0);

      await request(app)
        .patch(api(`/havales/${listing.body.data.id}`))
        .set('Cookie', owner.cookie)
        .send({ amountToman: 40_000_000 })
        .expect(200);

      // Not `updatedAt`, which moves on a renewal and on every reveal — the
      // marker has to mean «the owner changed this», or it means nothing.
      const after = await prisma.listing.findUnique({ where: { id: listing.body.data.id } });
      expect(after.editedAt).not.toBeNull();
      expect(after.editCount).toBe(1);
    });

    it('spells the changes out on the detail call', async () => {
      const admin = await staff();
      const owner = await agent();
      const listing = await request(app)
        .post(api('/havales'))
        .set('Cookie', owner.cookie)
        .send(await offer({ amountToman: 50_000_000, carPriceToman: 60_000_000, paidAmountToman: 20_000_000 }))
        .expect(201);

      await request(app)
        .patch(api(`/havales/${listing.body.data.id}`))
        .set('Cookie', owner.cookie)
        .send({ amountToman: 80_000_000 })
        .expect(200);

      const timeline = await request(app)
        .get(api('/admin/activity'))
        .query({ userId: owner.user.id, action: 'HAVALE_UPDATED' })
        .set('Cookie', admin.cookie)
        .expect(200);

      // The list carries the count, not the diff — fifty rows must not carry
      // fifty diffs.
      expect(timeline.body.data.items[0].changeCount).toBe(1);

      const entry = await request(app)
        .get(api(`/admin/activity/${timeline.body.data.items[0].id}`))
        .set('Cookie', admin.cookie)
        .expect(200);

      expect(entry.body.data.changes).toHaveLength(1);
      expect(entry.body.data.changes[0].label).toBe('مبلغ حواله');
    });
  });

  describe('where it came from', () => {
    it('records an address on an action a service performed, not just on login', async () => {
      // This is the one that was broken everywhere: thirty-six places write a
      // log row and only the login controller had a `req` to take an address
      // from. The request context is what closes that.
      const owner = await agent();
      await request(app)
        .post(api('/havales'))
        .set('Cookie', owner.cookie)
        .set('User-Agent', 'Mozilla/5.0 (Linux; Android 13) Chrome/120 Mobile Safari/537.36')
        .send(await offer())
        .expect(201);

      const entry = await lastEntry(owner.user.id, 'HAVALE_CREATED');
      expect(entry.ip).toBeTruthy();
      expect(entry.device).toBe('موبایل · Chrome');
    });
  });

  describe('slow requests', () => {
    const config = require('../../src/config');
    const errorLogService = require('../../src/modules/alert/errorLog.service');

    it('records a route once, however many times it is slow', async () => {
      const req = { originalUrl: '/api/v1/havales/cm4x7aaaaaaaaaaaaaaaaaaaa?x=1', method: 'GET', id: 'r1' };

      await errorLogService.recordSlow({ req, ms: 1400 });
      await errorLogService.recordSlow({ req, ms: 2600 });
      await errorLogService.recordSlow({ req, ms: 1900 });

      const rows = await prisma.errorLog.findMany({ where: { level: 'slow', method: 'GET' } });
      const row = rows.find((r) => r.path === '/api/v1/havales/:id');
      expect(row).toBeTruthy();
      // One row, not three: the id in the path is normalised away, so every
      // listing anybody opened slowly does not become its own entry.
      expect(row.count).toBe(3);
      // The worst time, not the latest — «how bad does this get?» is the
      // question, and the last sample is just whichever happened last.
      expect(row.durationMs).toBe(2600);

      await prisma.errorLog.delete({ where: { id: row.id } });
    });

    it('stays out of the error list, and the errors stay out of its own', async () => {
      const req = { originalUrl: '/api/v1/admin/agents', method: 'GET', id: 'r2' };
      await errorLogService.recordSlow({ req, ms: 1500 });

      const slow = await errorLogService.list({ level: 'slow' });
      const errs = await errorLogService.list({ level: 'error' });

      expect(slow.items.some((r) => r.path === '/api/v1/admin/agents')).toBe(true);
      expect(errs.items.some((r) => r.level === 'slow')).toBe(false);

      await prisma.errorLog.deleteMany({ where: { level: 'slow', path: '/api/v1/admin/agents' } });
    });

    it('has a threshold that is a setting, not a number in the code', () => {
      expect(typeof config.logging.slowRequestMs).toBe('number');
      expect(config.logging.slowRequestMs).toBeGreaterThan(0);
    });
  });

  describe('finding something in it', () => {
    it('filters by event family', async () => {
      const admin = await staff();
      const owner = await agent();
      await request(app)
        .post(api('/havales'))
        .set('Cookie', owner.cookie)
        .send(await offer())
        .expect(201);

      const listings = await request(app)
        .get(api('/admin/activity'))
        .query({ userId: owner.user.id, family: 'LISTING' })
        .set('Cookie', admin.cookie)
        .expect(200);

      expect(listings.body.data.items.length).toBeGreaterThan(0);
      listings.body.data.items.forEach((row) => expect(row.family).toBe('LISTING'));

      const auth = await request(app)
        .get(api('/admin/activity'))
        .query({ userId: owner.user.id, family: 'AUTH' })
        .set('Cookie', admin.cookie)
        .expect(200);

      auth.body.data.items.forEach((row) => expect(row.family).toBe('AUTH'));
      expect(auth.body.data.items.some((row) => row.action === 'HAVALE_CREATED')).toBe(false);
    });

    it('finds an agency by its code without knowing its id', async () => {
      const admin = await staff();
      const owner = await agent();
      await request(app)
        .post(api('/havales'))
        .set('Cookie', owner.cookie)
        .send(await offer())
        .expect(201);

      const found = await request(app)
        .get(api('/admin/activity'))
        .query({ q: owner.user.agencyCode })
        .set('Cookie', admin.cookie)
        .expect(200);

      expect(found.body.data.items.length).toBeGreaterThan(0);
      found.body.data.items.forEach((row) => expect(row.actor.id).toBe(owner.user.id));
    });

    it('follows one listing by the serial the panel shows', async () => {
      const admin = await staff();
      const owner = await agent();
      const listing = await request(app)
        .post(api('/havales'))
        .set('Cookie', owner.cookie)
        .send(await offer({ amountToman: 50_000_000, carPriceToman: 60_000_000, paidAmountToman: 20_000_000 }))
        .expect(201);

      await request(app)
        .patch(api(`/havales/${listing.body.data.id}`))
        .set('Cookie', owner.cookie)
        .send({ amountToman: 90_000_000 })
        .expect(200);

      const row = await prisma.listing.findUnique({
        where: { id: listing.body.data.id },
        select: { serial: true },
      });

      const history = await request(app)
        .get(api('/admin/activity'))
        .query({ serial: row.serial })
        .set('Cookie', admin.cookie)
        .expect(200);

      const actions = history.body.data.items.map((i) => i.action);
      expect(actions).toContain('HAVALE_CREATED');
      expect(actions).toContain('HAVALE_UPDATED');
      history.body.data.items.forEach((i) => expect(i.targetId).toBe(listing.body.data.id));
    });

    it('returns nothing for a serial that does not exist, not everything', async () => {
      const admin = await staff();
      const empty = await request(app)
        .get(api('/admin/activity'))
        .query({ serial: 99_999_999 })
        .set('Cookie', admin.cookie)
        .expect(200);

      expect(empty.body.data.total).toBe(0);
      expect(empty.body.data.items).toEqual([]);
    });

    it('always answers within a window, so the count can never scan the table', async () => {
      const admin = await staff();
      const answer = await request(app)
        .get(api('/admin/activity'))
        .set('Cookie', admin.cookie)
        .expect(200);

      // Stated back to the caller, because a page that silently hides older
      // rows is worse than one that says it is showing the last month.
      expect(new Date(answer.body.data.from).getTime()).toBeLessThan(Date.now());
      expect(Date.now() - new Date(answer.body.data.from).getTime()).toBeLessThanOrEqual(
        31 * 24 * 60 * 60 * 1000
      );
    });

    it('publishes the families rather than making the panel guess them', async () => {
      const admin = await staff();
      const res = await request(app)
        .get(api('/admin/activity/families'))
        .set('Cookie', admin.cookie)
        .expect(200);

      const keys = res.body.data.families.map((f) => f.key);
      expect(keys).toContain('LISTING');
      expect(keys).toContain('SECURITY');
      res.body.data.families.forEach((f) => expect(f.label).toBeTruthy());
    });

    it('refuses a family nobody defined', async () => {
      const admin = await staff();
      await request(app)
        .get(api('/admin/activity'))
        .query({ family: 'WHATEVER' })
        .set('Cookie', admin.cookie)
        .expect(422);
    });
  });
});
