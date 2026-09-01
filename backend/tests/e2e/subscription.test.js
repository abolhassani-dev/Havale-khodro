const request = require('supertest');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

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

  /**
   * The other half of the billing conversation.
   *
   * `grant` answers «they paid for a plan». This answers «give them until the
   * end of Mehr» — a settlement, a goodwill week, a period agreed off the
   * price list — and «stop it today». Both are things an administrator on the
   * telephone needs, and both used to mean editing the database by hand.
   */
  describe('managing a subscription by hand', () => {
    it('moves the end date and keeps the plan, and refuses support staff', async () => {
      const target = await agent();
      const plan = await ensurePlan();
      const finance = await admin('FINANCE');

      await request(app)
        .post(api('/subscriptions/grant'))
        .set('Cookie', finance.cookie)
        .send({ userId: target.user.id, planId: plan.id })
        .expect(201);

      const until = new Date(Date.now() + 200 * 24 * 60 * 60 * 1000);

      const support = await admin('SUPPORT');
      await request(app)
        .post(api('/subscriptions/expiry'))
        .set('Cookie', support.cookie)
        .send({ userId: target.user.id, expiresAt: until.toISOString() })
        .expect(403);

      const res = await request(app)
        .post(api('/subscriptions/expiry'))
        .set('Cookie', finance.cookie)
        .send({ userId: target.user.id, expiresAt: until.toISOString(), note: 'توافق تلفنی' })
        .expect(200);
      expect(new Date(res.body.data.expiresAt).toDateString()).toBe(until.toDateString());
      // The allowances come from the plan, so moving a date must not move them.
      expect(res.body.data.plan.name).toBe(plan.name);

      // Still exactly one live row: the date moved, it did not add a period.
      const live = await prisma.subscription.count({
        where: { userId: target.user.id, status: 'ACTIVE' },
      });
      expect(live).toBe(1);
    });

    it('refuses a date in the past, and needs a plan when nothing is live', async () => {
      const target = await agent();
      const finance = await admin('FINANCE');
      const until = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      await request(app)
        .post(api('/subscriptions/expiry'))
        .set('Cookie', finance.cookie)
        .send({ userId: target.user.id, expiresAt: new Date(Date.now() - 1000).toISOString() })
        .expect(422);

      // Nothing live: there is no plan to take the daily and monthly
      // allowances from, so one has to be named.
      await prisma.subscription.updateMany({
        where: { userId: target.user.id },
        data: { status: 'EXPIRED' },
      });
      await request(app)
        .post(api('/subscriptions/expiry'))
        .set('Cookie', finance.cookie)
        .send({ userId: target.user.id, expiresAt: until.toISOString() })
        .expect(400);

      const plan = await ensurePlan();
      await request(app)
        .post(api('/subscriptions/expiry'))
        .set('Cookie', finance.cookie)
        .send({ userId: target.user.id, expiresAt: until.toISOString(), planId: plan.id })
        .expect(200);
    });

    it('cancels, and the file counts what was bought without counting seats', async () => {
      const target = await agent();
      const plan = await ensurePlan();
      const finance = await admin('FINANCE');

      await request(app)
        .post(api('/subscriptions/grant'))
        .set('Cookie', finance.cookie)
        .send({ userId: target.user.id, planId: plan.id })
        .expect(201);

      // Reading the file needs the `agents` permission, which finance does
      // not hold — the money and the accounts are separate keys.
      const boss = await admin('SUPER_ADMIN');
      const file = await request(app)
        .get(api(`/admin/agents/${target.user.id}`))
        .set('Cookie', boss.cookie)
        .expect(200);
      const sub = file.body.data.subscription;
      expect(sub.current).not.toBeNull();
      expect(sub.current.daysLeft).toBeGreaterThan(0);
      expect(sub.purchases).toBeGreaterThanOrEqual(1);
      expect(sub.history.length).toBeGreaterThanOrEqual(1);
      // A seat is access a parent hands down, not a purchase.
      expect(sub.history.every((h) => h.origin !== 'PARENT_SEAT' || h.priceToman === 0)).toBe(true);

      await request(app)
        .post(api('/subscriptions/cancel'))
        .set('Cookie', finance.cookie)
        .send({ userId: target.user.id, note: 'بازگشت وجه' })
        .expect(200);

      const after = await request(app)
        .get(api(`/admin/agents/${target.user.id}`))
        .set('Cookie', boss.cookie)
        .expect(200);
      expect(after.body.data.subscription.current).toBeNull();
      // The period is kept, not deleted: it is what the history is made of.
      expect(after.body.data.subscription.history.length).toBe(sub.history.length);
    });
  });

  describe('buying capacity', () => {
    // Capacity is prepaid by bank transfer, so every order carries the slip.
    const RECEIPT = Buffer.from(
      '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489' +
        '0000000d49444154789c626001000000ffff03000006000557bfabd4000000004945' +
        '4e44ae426082',
      'hex'
    );

    /** An order the way the form sends one: multipart, slip attached. */
    const placeOrder = (cookie, seats, note) => {
      const req = request(app)
        .post(api('/subscriptions/seat-orders'))
        .set('Cookie', cookie)
        .field('seats', String(seats));
      if (note) req.field('note', note);
      return req.attach('receipt', RECEIPT, 'فیش.png');
    };

    it('is refused to an agency without module mode', async () => {
      const { cookie } = await agent();

      const res = await placeOrder(cookie, 5).expect(403);

      expect(res.body.error.message).toContain('ماژول');
    });

    /**
     * Approving an order means «I can see this money in the account», and
     * nobody can see it from a number typed into a form. The slip is required
     * by the service rather than by the page, so there is no way in without it.
     */
    it('is refused without the deposit slip', async () => {
      const { cookie } = await agent({ isReseller: true });

      const res = await request(app)
        .post(api('/subscriptions/seat-orders'))
        .set('Cookie', cookie)
        .send({ seats: 3 })
        .expect(400);

      expect(res.body.error.message).toContain('فیش');
    });

    it('serves the slip to its buyer and to staff, and to nobody else', async () => {
      const buyer = await agent({ isReseller: true });
      const stranger = await agent({ isReseller: true });
      const finance = await admin('FINANCE');

      const res = await placeOrder(buyer.cookie, 2).expect(201);
      const { receipt } = res.body.data;

      expect(receipt.name).toBe('فیش.png');
      expect(receipt.mime).toBe('image/png');
      // The stored name is generated — an uploaded filename is display text,
      // never part of a path.
      expect(receipt.url).not.toContain('فیش');

      await request(app).get(receipt.url).set('Cookie', buyer.cookie).expect(200);
      await request(app).get(receipt.url).set('Cookie', finance.cookie).expect(200);
      // Not-found rather than forbidden: an outsider must not learn the order
      // exists at all.
      await request(app).get(receipt.url).set('Cookie', stranger.cookie).expect(404);
    });

    it('refuses a slip of a type it cannot display', async () => {
      const { cookie } = await agent({ isReseller: true });

      const res = await request(app)
        .post(api('/subscriptions/seat-orders'))
        .set('Cookie', cookie)
        .field('seats', '2')
        .attach('receipt', Buffer.from('#!/bin/sh\necho hi\n'), 'slip.sh')
        .expect(400);

      expect(res.body.error.message).toContain('PDF');
    });

    /**
     * Multer writes the file before anything downstream reads the request, so
     * a refused order would otherwise leave a five-megabyte file on the disk
     * that no row will ever point at.
     */
    it('leaves no file behind when the order itself is refused', async () => {
      const { cookie } = await agent({ isReseller: true });
      const dir = path.join(process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads'), 'receipts');
      const before = fs.existsSync(dir) ? fs.readdirSync(dir).length : 0;

      await request(app)
        .post(api('/subscriptions/seat-orders'))
        .set('Cookie', cookie)
        .field('seats', '0') // refused by the schema, after the file is stored
        .attach('receipt', RECEIPT, 'فیش.png')
        .expect(422);

      // The delete is scheduled when the response finishes, so give it a moment
      // rather than racing it.
      let after = before + 1;
      for (let tries = 0; tries < 20 && after !== before; tries += 1) {
        after = fs.existsSync(dir) ? fs.readdirSync(dir).length : 0;
        if (after !== before) await new Promise((done) => setTimeout(done, 50));
      }
      expect(after).toBe(before);
    });

    it('prices the order from the settings table, not from code', async () => {
      await settingsService.set('seat.priceToman', 1_500_000n);
      const { cookie } = await agent({ isReseller: true });

      const res = await placeOrder(cookie, 4).expect(201);

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

      const order = await placeOrder(reseller.cookie, 3).expect(201);

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

    /**
     * The buyer is told what happened to their request.
     *
     * A capacity order is decided by somebody else, at a time the buyer is not
     * watching. Without this they learn about it by wandering back to the page
     * and noticing a number changed — so the decision waits on their dashboard
     * until they dismiss it, and only they can dismiss it.
     */
    it('notifies the buyer of a decision until they dismiss it', async () => {
      const reseller = await agent({ isReseller: true });
      const other = await agent({ isReseller: true });
      const finance = await admin('FINANCE');

      const order = await placeOrder(reseller.cookie, 2).expect(201);

      // Nothing to announce while it is still pending.
      let alerts = await request(app)
        .get(api('/subscriptions/seat-orders/alerts'))
        .set('Cookie', reseller.cookie)
        .expect(200);
      expect(alerts.body.data).toHaveLength(0);

      await request(app)
        .post(api(`/subscriptions/seat-orders/${order.body.data.id}/review`))
        .set('Cookie', finance.cookie)
        .send({ approve: true, note: 'واریز تأیید شد' })
        .expect(200);

      alerts = await request(app)
        .get(api('/subscriptions/seat-orders/alerts'))
        .set('Cookie', reseller.cookie)
        .expect(200);
      expect(alerts.body.data).toHaveLength(1);
      expect(alerts.body.data[0].status).toBe('PAID');

      // Somebody else's order is not theirs to dismiss — and answers the same
      // way a missing one does.
      await request(app)
        .post(api(`/subscriptions/seat-orders/${order.body.data.id}/ack`))
        .set('Cookie', other.cookie)
        .expect(404);

      await request(app)
        .post(api(`/subscriptions/seat-orders/${order.body.data.id}/ack`))
        .set('Cookie', reseller.cookie)
        .expect(200);

      alerts = await request(app)
        .get(api('/subscriptions/seat-orders/alerts'))
        .set('Cookie', reseller.cookie)
        .expect(200);
      expect(alerts.body.data).toHaveLength(0);
    });

    it('cannot be approved twice from one payment', async () => {
      const reseller = await agent({ isReseller: true });
      const finance = await admin('FINANCE');

      const order = await placeOrder(reseller.cookie, 2).expect(201);

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

      // Suspension has to bite now, not when the session happens to expire: the
      // parent ends the live session as it turns the seat off.
      await request(app).get(api('/auth/me')).set('Cookie', childCookie).expect(401);

      // Signing back in is allowed, and says so plainly. A sub-agency turned off
      // by its own parent is not a fraud case — it needs to read what happened,
      // not guess at a rejected password.
      await request(app)
        .post(api('/auth/login'))
        .send({ username: payload.username, password: payload.password })
        .expect(200);
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
