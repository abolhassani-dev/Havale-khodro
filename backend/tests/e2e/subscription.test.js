const request = require('supertest');
const bcrypt = require('bcryptjs');

const app = require('../../src/app');
const { prisma, connectDatabase, disconnectDatabase } = require('../../src/config/database');
const settingsService = require('../../src/modules/settings/settings.service');
const {
  api,
  PASSWORD,
  offer,
  catalog,
  createAgent,
  ensurePlan,
  giveSubscription,
  signIn,
  signedInAgent,
  cleanup,
} = require('../helpers/factory');

/**
 * Subscriptions, module mode and the money.
 *
 * The rules under test are the ones somebody could otherwise get around: paying
 * for capacity only after using it, resetting the monthly allowance by renewing
 * early, or a sub-agency outliving the parent that paid for it.
 *
 * Needs a database:  RUN_E2E=1 npm run test:e2e
 */
const maybe = process.env.RUN_E2E ? describe : describe.skip;

maybe('subscription and module mode', () => {
  const created = [];

  const agent = async (overrides) => {
    const signed = await signedInAgent(overrides);
    created.push(signed.user.id);
    return signed;
  };

  /** An admin who can grant subscriptions and confirm capacity payments. */
  const admin = async (role = 'SUPER_ADMIN') => {
    const tag = `${Date.now()}${Math.floor(Math.random() * 999)}`;
    const user = await prisma.user.create({
      data: {
        username: `test_admin_${tag}`,
        passwordHash: await bcrypt.hash(PASSWORD, 4),
        phone: `0914${tag.slice(-7)}`,
        fullName: 'مدیر تست',
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
  });

  afterAll(async () => {
    await prisma.seatOrder.deleteMany({ where: { buyerId: { in: created } } });
    await cleanup(created);
    await prisma.setting.deleteMany({ where: { key: 'seat.priceToman' } });
    await disconnectDatabase();
  });

  describe('the agent’s own subscription', () => {
    it('reports the expiry, the plan and the caps', async () => {
      const { cookie } = await agent();

      const res = await request(app)
        .get(api('/subscriptions/me'))
        .set('Cookie', cookie)
        .expect(200);

      expect(res.body.data.active).toBe(true);
      expect(res.body.data.daysLeft).toBeGreaterThan(28);
      expect(res.body.data.limits.daily).toBe(30);
      expect(res.body.data.dependsOnParent).toBe(false);
    });

    it('tells a sub-agency that its dates come from the parent', async () => {
      const parent = await agent({ isReseller: true, seatCredits: 5 });
      const child = await createAgent({ parentId: parent.user.id });
      created.push(child.id);
      await giveSubscription(child, { origin: 'PARENT_SEAT', days: 3650 });

      const res = await request(app)
        .get(api('/subscriptions/me'))
        .set('Cookie', await signIn(child))
        .expect(200);

      // Their own row says ten years. Showing that number would be a promise the
      // system does not keep — the date that governs them is the parent's.
      expect(res.body.data.dependsOnParent).toBe(true);
      expect(res.body.data.daysLeft).toBeLessThan(40);
    });
  });

  describe('granting a subscription', () => {
    it('is refused to support staff and allowed to finance', async () => {
      const target = await agent();
      const plan = await ensurePlan();

      const support = await admin('SUPPORT');
      await request(app)
        .post(api('/subscriptions/grant'))
        .set('Cookie', support.cookie)
        .send({ userId: target.user.id, planId: plan.id })
        .expect(403);

      // Support answering a billing question must not be able to hand out a free
      // month (blueprint 11.12).
      const finance = await admin('FINANCE');
      await request(app)
        .post(api('/subscriptions/grant'))
        .set('Cookie', finance.cookie)
        .send({ userId: target.user.id, planId: plan.id })
        .expect(201);
    });

    it('runs the new period from today, not from the old expiry date', async () => {
      const target = await agent();
      const plan = await ensurePlan();

      // Let the existing subscription lapse a week ago.
      await prisma.subscription.updateMany({
        where: { userId: target.user.id },
        data: { expiresAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      });

      const finance = await admin('FINANCE');
      const res = await request(app)
        .post(api('/subscriptions/grant'))
        .set('Cookie', finance.cookie)
        .send({ userId: target.user.id, planId: plan.id })
        .expect(201);

      // Dating the new period from the lapse would silently charge the agency
      // for the week it had no service.
      const days = (new Date(res.body.data.expiresAt) - Date.now()) / (24 * 60 * 60 * 1000);
      expect(days).toBeGreaterThan(29);
    });

    it('leaves exactly one live subscription behind', async () => {
      const target = await agent();
      const plan = await ensurePlan();
      const finance = await admin('FINANCE');

      await request(app)
        .post(api('/subscriptions/grant'))
        .set('Cookie', finance.cookie)
        .send({ userId: target.user.id, planId: plan.id })
        .expect(201);

      // Two live rows would both look authoritative, and the resolver picks by
      // expiry — so a renewal onto a shorter plan could keep the longer one.
      const live = await prisma.subscription.count({
        where: { userId: target.user.id, status: 'ACTIVE' },
      });
      expect(live).toBe(1);
    });
  });

  describe('buying capacity', () => {
    it('is refused to an agency without module mode', async () => {
      const { cookie } = await agent();

      const res = await request(app)
        .post(api('/subscriptions/seat-orders'))
        .set('Cookie', cookie)
        .send({ seats: 5 })
        .expect(403);

      expect(res.body.error.message).toContain('ماژول');
    });

    it('prices the order from the settings table, not from code', async () => {
      await settingsService.set('seat.priceToman', 1_500_000n);
      const { cookie } = await agent({ isReseller: true });

      const res = await request(app)
        .post(api('/subscriptions/seat-orders'))
        .set('Cookie', cookie)
        .send({ seats: 4 })
        .expect(201);

      // Blueprint 4.10: the price is a business decision, so it lives where the
      // business can change it.
      expect(res.body.data.unitPriceToman).toBe(1_500_000);
      expect(res.body.data.totalToman).toBe(6_000_000);
      expect(res.body.data.status).toBe('PENDING');

      await settingsService.set('seat.priceToman', 1_000_000n);
    });

    it('grants the capacity only when the payment is confirmed', async () => {
      const reseller = await agent({ isReseller: true });
      const finance = await admin('FINANCE');

      const order = await request(app)
        .post(api('/subscriptions/seat-orders'))
        .set('Cookie', reseller.cookie)
        .send({ seats: 3 })
        .expect(201);

      const before = await prisma.user.findUnique({ where: { id: reseller.user.id } });
      expect(before.seatCredits).toBe(0);

      await request(app)
        .post(api(`/subscriptions/seat-orders/${order.body.data.id}/review`))
        .set('Cookie', finance.cookie)
        .send({ approve: true })
        .expect(200);

      const after = await prisma.user.findUnique({ where: { id: reseller.user.id } });
      expect(after.seatCredits).toBe(3);
    });

    it('cannot be approved twice from one payment', async () => {
      const reseller = await agent({ isReseller: true });
      const finance = await admin('FINANCE');

      const order = await request(app)
        .post(api('/subscriptions/seat-orders'))
        .set('Cookie', reseller.cookie)
        .send({ seats: 2 })
        .expect(201);

      const review = () =>
        request(app)
          .post(api(`/subscriptions/seat-orders/${order.body.data.id}/review`))
          .set('Cookie', finance.cookie)
          .send({ approve: true });

      await review().expect(200);
      await review().expect(400);

      const after = await prisma.user.findUnique({ where: { id: reseller.user.id } });
      expect(after.seatCredits).toBe(2);
    });
  });

  describe('creating sub-agencies', () => {
    let n = 0;
    const childPayload = (tag) => ({
      username: `test_child_${tag}`,
      password: 'Str0ngPassw0rd!',
      fullName: 'زیرنماینده تست',
      // Digits only, and unique per call — the tag may carry letters.
      phone: `0916${String(Date.now()).slice(-6)}${(n += 1) % 10}`,
      agencyName: 'زیرنمایندگی تست',
      city: 'کرج',
      coordinatorName: 'مسئول هماهنگی',
      coordinatorPhone: '09160000000',
    });

    it('derives the agency code from the parent’s and counts up', async () => {
      const parent = await agent({
        isReseller: true,
        seatCredits: 5,
        agencyCode: `G-${Date.now().toString().slice(-6)}`,
      });

      const first = await request(app)
        .post(api('/sub-agents'))
        .set('Cookie', parent.cookie)
        .send(childPayload(`${Date.now()}a`))
        .expect(201);
      created.push(first.body.data.id);

      const second = await request(app)
        .post(api('/sub-agents'))
        .set('Cookie', parent.cookie)
        .send(childPayload(`${Date.now()}b`))
        .expect(201);
      created.push(second.body.data.id);

      // A violation report points at a code, so the code has to say which
      // sub-agency of which parent without anyone looking it up.
      expect(first.body.data.agencyCode).toBe(`${parent.user.agencyCode}-01`);
      expect(second.body.data.agencyCode).toBe(`${parent.user.agencyCode}-02`);
      expect(first.body.data.mustChangePassword).toBe(true);
    });

    it('refuses without capacity', async () => {
      const parent = await agent({ isReseller: true, seatCredits: 0 });

      const res = await request(app)
        .post(api('/sub-agents'))
        .set('Cookie', parent.cookie)
        .send(childPayload(Date.now()))
        .expect(403);

      expect(res.body.error.message).toContain('ظرفیت');
    });

    it('refuses a second level', async () => {
      const parent = await agent({ isReseller: true, seatCredits: 5 });
      const child = await createAgent({
        parentId: parent.user.id,
        isReseller: true,
        seatCredits: 5,
      });
      created.push(child.id);
      await giveSubscription(child, { origin: 'PARENT_SEAT' });

      // One level only (blueprint 2.4): a tree would turn one subscription into
      // an unbounded number of accounts.
      await request(app)
        .post(api('/sub-agents'))
        .set('Cookie', await signIn(child))
        .send(childPayload(Date.now()))
        .expect(403);
    });

    it('does not release the seat when a sub-agency is suspended mid-period', async () => {
      const parent = await agent({
        isReseller: true,
        seatCredits: 1,
        agencyCode: `G-${Date.now().toString().slice(-6)}`,
      });

      const child = await request(app)
        .post(api('/sub-agents'))
        .set('Cookie', parent.cookie)
        .send(childPayload(Date.now()))
        .expect(201);
      created.push(child.body.data.id);

      await request(app)
        .put(api(`/sub-agents/${child.body.data.id}/status`))
        .set('Cookie', parent.cookie)
        .send({ status: 'SUSPENDED' })
        .expect(200);

      // Capacity is prepaid. If suspending freed the seat, a reseller could
      // suspend everyone on the last day of the month, reactivate on the first,
      // and never pay for capacity (blueprint 4.8).
      const seats = await request(app)
        .get(api('/subscriptions/seats'))
        .set('Cookie', parent.cookie)
        .expect(200);

      expect(seats.body.data.available).toBe(0);

      await request(app)
        .post(api('/sub-agents'))
        .set('Cookie', parent.cookie)
        .send(childPayload(`${Date.now()}z`))
        .expect(403);
    });

    it('signs a sub-agency out the moment it is suspended', async () => {
      const parent = await agent({
        isReseller: true,
        seatCredits: 2,
        agencyCode: `G-${Date.now().toString().slice(-6)}`,
      });

      const payload = childPayload(Date.now());
      const child = await request(app)
        .post(api('/sub-agents'))
        .set('Cookie', parent.cookie)
        .send(payload)
        .expect(201);
      created.push(child.body.data.id);

      const childCookie = await signIn({ username: payload.username });
      await request(app).get(api('/auth/me')).set('Cookie', childCookie).expect(200);

      await request(app)
        .put(api(`/sub-agents/${child.body.data.id}/status`))
        .set('Cookie', parent.cookie)
        .send({ status: 'SUSPENDED' })
        .expect(200);

      // Suspension has to bite now, not when the session happens to expire, and
      // it has to say why: "your session is invalid" would send them to support
      // instead of telling them what happened.
      const after = await request(app).get(api('/auth/me')).set('Cookie', childCookie).expect(403);
      expect(after.body.error.message).toContain('تعلیق');
    });

    it('shows the parent counts but not the sub-agency’s listings', async () => {
      const parent = await agent({
        isReseller: true,
        seatCredits: 2,
        agencyCode: `G-${Date.now().toString().slice(-6)}`,
      });

      const payload = childPayload(Date.now());
      const childRes = await request(app)
        .post(api('/sub-agents'))
        .set('Cookie', parent.cookie)
        .send(payload)
        .expect(201);
      created.push(childRes.body.data.id);

      // Let the sub-agency post something, then change its password so it can
      // sign in past the forced-change flag.
      await prisma.user.update({
        where: { id: childRes.body.data.id },
        data: { mustChangePassword: false },
      });
      const childCookie = await signIn({ username: payload.username });
      await request(app)
        .post(api('/havales'))
        .set('Cookie', childCookie)
        .send(await offer())
        .expect(201);

      const res = await request(app).get(api('/sub-agents')).set('Cookie', parent.cookie).expect(200);
      const row = res.body.data.items.find((i) => i.id === childRes.body.data.id);

      expect(row.havaleCount).toBe(1);
      // A count, not a window. A sub-agency's deals are its own (blueprint 4.6).
      expect(row.havales).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain('passwordHash');
    });

    it('refuses to manage somebody else’s sub-agency', async () => {
      const parentA = await agent({
        isReseller: true,
        seatCredits: 2,
        agencyCode: `G-${Date.now().toString().slice(-6)}`,
      });
      const parentB = await agent({ isReseller: true, seatCredits: 2 });

      const child = await request(app)
        .post(api('/sub-agents'))
        .set('Cookie', parentA.cookie)
        .send(childPayload(Date.now()))
        .expect(201);
      created.push(child.body.data.id);

      await request(app)
        .put(api(`/sub-agents/${child.body.data.id}/status`))
        .set('Cookie', parentB.cookie)
        .send({ status: 'SUSPENDED' })
        .expect(404);

      await request(app)
        .put(api(`/sub-agents/${child.body.data.id}/password`))
        .set('Cookie', parentB.cookie)
        .send({ password: 'An0therStr0ngOne!' })
        .expect(404);
    });
  });

  describe('the invoice', () => {
    it('is the agency’s own plan plus one seat charge per active sub-agency', async () => {
      await settingsService.set('seat.priceToman', 1_000_000n);

      const parent = await agent({
        isReseller: true,
        seatCredits: 3,
        agencyCode: `G-${Date.now().toString().slice(-6)}`,
      });

      for (let i = 0; i < 2; i += 1) {
        const res = await request(app)
          .post(api('/sub-agents'))
          .set('Cookie', parent.cookie)
          .send({
            username: `test_inv_${Date.now()}${i}`,
            password: 'Str0ngPassw0rd!',
            fullName: 'زیرنماینده تست',
            phone: `0917${String(Date.now()).slice(-6)}${i}`,
            agencyName: 'زیرنمایندگی',
            city: 'اصفهان',
            coordinatorName: 'مسئول هماهنگی',
            coordinatorPhone: '09170000000',
          })
          .expect(201);
        created.push(res.body.data.id);
      }

      const res = await request(app)
        .get(api('/subscriptions/invoice'))
        .set('Cookie', parent.cookie)
        .expect(200);

      // The worked example in blueprint 4.7: 25 million for the agency's own
      // plan plus 1 million per sub-agency.
      expect(res.body.data.totalToman).toBe(25_000_000 + 2_000_000);
      expect(res.body.data.lines[1].quantity).toBe(2);
    });
  });
});
