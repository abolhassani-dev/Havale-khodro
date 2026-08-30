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
  signIn,
  signedInAgent,
  cleanup,
} = require('../helpers/factory');

/**
 * Violation reports and support tickets.
 *
 * The requirement was two things at once: stop fake listings, and stop
 * vexatious reports. A system that only punishes the accused becomes a weapon —
 * report every competitor three times and they are suspended. So most of what
 * follows tests that the feature cuts both ways.
 *
 * Needs a database:  RUN_E2E=1 npm run test:e2e
 */
const maybe = process.env.RUN_E2E ? describe : describe.skip;

maybe('moderation', () => {
  const created = [];

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
        phone: `0918${tag.slice(-7)}`,
        fullName: 'کارمند تست',
        role,
        mustChangePassword: false,
      },
    });
    created.push(user.id);
    return { user, cookie: await signIn(user) };
  };

  /** An owner with a live listing, and someone else able to report it. */
  async function listingAndReporter() {
    const owner = await agent();
    const reporter = await agent();
    const res = await request(app)
      .post(api('/havales'))
      .set('Cookie', owner.cookie)
      .send(await offer())
      .expect(201);
    return { owner, reporter, havale: res.body.data };
  }

  const file = (cookie, listingId, overrides = {}) =>
    request(app)
      .post(api('/reports'))
      .set('Cookie', cookie)
      .send({
        listingId,
        reason: 'FAKE_LISTING',
        description: 'این آگهی جعلی است و خودرویی پشت آن وجود ندارد.',
        ...overrides,
      });

  beforeAll(async () => {
    await connectDatabase();
    await catalog();
  });

  afterEach(async () => {
    await prisma.setting.deleteMany({ where: { key: 'report.dailyLimit' } });
  });

  afterAll(async () => {
    await prisma.violationReport.deleteMany({ where: { reporterId: { in: created } } });
    await prisma.ticket.deleteMany({ where: { userId: { in: created } } });
    await prisma.smsMessage.deleteMany({ where: { userId: { in: created } } });
    await cleanup(created);
    await disconnectDatabase();
  });

  describe('filing a report', () => {
    it('records it against the listing', async () => {
      const { reporter, havale } = await listingAndReporter();

      const res = await file(reporter.cookie, havale.id).expect(201);
      expect(res.body.data.status).toBe('PENDING');

      const fresh = await prisma.listing.findUnique({ where: { id: havale.id } });
      expect(fresh.reportCount).toBe(1);
    });

    it('refuses a short explanation', async () => {
      const { reporter, havale } = await listingAndReporter();
      // A one-word report cannot be investigated and cannot be answered.
      await file(reporter.cookie, havale.id, { description: 'بده' }).expect(422);
    });

    it('allows only one report per agency per listing', async () => {
      const { reporter, havale } = await listingAndReporter();

      await file(reporter.cookie, havale.id).expect(201);
      // Without this, three colleagues could file fifteen reports between them
      // and manufacture a suspension.
      await file(reporter.cookie, havale.id).expect(409);
    });

    it('refuses reporting your own listing', async () => {
      const { owner, havale } = await listingAndReporter();
      await file(owner.cookie, havale.id).expect(400);
    });

    it('stops at the daily cap', async () => {
      await settingsService.set('report.dailyLimit', 1);

      const reporter = await agent();
      const owner = await agent();

      const ids = [];
      for (let i = 0; i < 2; i += 1) {
        const res = await request(app)
          .post(api('/havales'))
          .set('Cookie', owner.cookie)
          .send(await offer())
          .expect(201);
        ids.push(res.body.data.id);
      }

      await file(reporter.cookie, ids[0]).expect(201);
      const blocked = await file(reporter.cookie, ids[1]).expect(403);
      expect(blocked.body.error.message).toContain('سقف');
    });

    it('requires an expired agency to renew first', async () => {
      const { reporter, havale } = await listingAndReporter();
      await prisma.subscription.updateMany({
        where: { userId: reporter.user.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const res = await file(reporter.cookie, havale.id).expect(403);
      expect(res.body.error.code).toBe('SUBSCRIPTION_EXPIRED');
    });

    it('accepts a report on a deleted listing', async () => {
      const { owner, reporter, havale } = await listingAndReporter();

      await request(app)
        .delete(api(`/havales/${havale.id}`))
        .set('Cookie', owner.cookie)
        .expect(200);

      // Otherwise the escape route is obvious: take the calls, then delete the
      // listing before anyone complains (review round 3, fix 7).
      await file(reporter.cookie, havale.id).expect(201);
    });

    it('refuses a report older than the thirty-day window', async () => {
      const { reporter, havale } = await listingAndReporter();

      await prisma.listing.update({
        where: { id: havale.id },
        data: { closesAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) },
      });

      await file(reporter.cookie, havale.id).expect(400);
    });

    it('requires "nobody answers" to be backed by an actual call', async () => {
      const { reporter, havale } = await listingAndReporter();

      const refused = await file(reporter.cookie, havale.id, {
        reason: 'UNREACHABLE',
        description: 'چند بار تماس گرفتم و کسی جواب نداد.',
      }).expect(400);
      expect(refused.body.error.message).toContain('عدم پاسخگویی');

      // The reveal log is the proof they tried (blueprint 8.2).
      await request(app)
        .post(api(`/havales/${havale.id}/reveal`))
        .set('Cookie', reporter.cookie)
        .expect(200);

      await file(reporter.cookie, havale.id, {
        reason: 'UNREACHABLE',
        description: 'چند بار تماس گرفتم و کسی جواب نداد.',
      }).expect(201);
    });
  });

  describe('the verdict', () => {
    it('takes the listing down and strikes the advertiser when upheld', async () => {
      const { owner, reporter, havale } = await listingAndReporter();
      const support = await staff('SUPPORT');

      const report = await file(reporter.cookie, havale.id).expect(201);

      await request(app)
        .post(api(`/reports/${report.body.data.id}/review`))
        .set('Cookie', support.cookie)
        .send({ verdict: 'CONFIRMED', note: 'بررسی شد' })
        .expect(200);

      const listing = await prisma.listing.findUnique({ where: { id: havale.id } });
      expect(listing.status).toBe('SUSPENDED');

      const advertiser = await prisma.user.findUnique({ where: { id: owner.user.id } });
      expect(advertiser.fakeStrikes).toBe(1);
      expect(advertiser.status).toBe('ACTIVE');
    });

    it('strikes the reporter instead when the report is vexatious', async () => {
      const { reporter, havale } = await listingAndReporter();
      const support = await staff('SUPPORT');

      const report = await file(reporter.cookie, havale.id).expect(201);

      await request(app)
        .post(api(`/reports/${report.body.data.id}/review`))
        .set('Cookie', support.cookie)
        .send({ verdict: 'ABUSIVE' })
        .expect(200);

      // The whole point of the two-sided design: reporting is not free.
      const filer = await prisma.user.findUnique({ where: { id: reporter.user.id } });
      expect(filer.falseReportStrikes).toBe(1);

      const listing = await prisma.listing.findUnique({ where: { id: havale.id } });
      expect(listing.status).toBe('ACTIVE');
    });

    it('cannot be decided twice', async () => {
      const { reporter, havale } = await listingAndReporter();
      const support = await staff('SUPPORT');
      const report = await file(reporter.cookie, havale.id).expect(201);

      const review = () =>
        request(app)
          .post(api(`/reports/${report.body.data.id}/review`))
          .set('Cookie', support.cookie)
          .send({ verdict: 'CONFIRMED' });

      await review().expect(200);
      await review().expect(400);
    });

    it('hides the listing without a strike while it is being looked into', async () => {
      const { owner, reporter, havale } = await listingAndReporter();
      const support = await staff('SUPPORT');
      const report = await file(reporter.cookie, havale.id).expect(201);

      await request(app)
        .post(api(`/reports/${report.body.data.id}/hold`))
        .set('Cookie', support.cookie)
        .send({ note: 'نیاز به بررسی بیشتر' })
        .expect(200);

      const listing = await prisma.listing.findUnique({ where: { id: havale.id } });
      expect(listing.status).toBe('SUSPENDED');

      // Nothing is proven yet, so nothing lands on anyone's record.
      const advertiser = await prisma.user.findUnique({ where: { id: owner.user.id } });
      expect(advertiser.fakeStrikes).toBe(0);
      const fresh = await prisma.violationReport.findUnique({
        where: { id: report.body.data.id },
      });
      expect(fresh.status).toBe('PENDING');
    });

    it('is closed to finance staff', async () => {
      const { reporter, havale } = await listingAndReporter();
      const finance = await staff('FINANCE');
      const report = await file(reporter.cookie, havale.id).expect(201);

      await request(app)
        .post(api(`/reports/${report.body.data.id}/review`))
        .set('Cookie', finance.cookie)
        .send({ verdict: 'CONFIRMED' })
        .expect(403);
    });
  });

  describe('the third strike', () => {
    /** Puts an advertiser one strike away from suspension. */
    async function almostSuspended() {
      const { owner, reporter, havale } = await listingAndReporter();
      await prisma.user.update({
        where: { id: owner.user.id },
        data: { fakeStrikes: 2 },
      });
      const report = await file(reporter.cookie, havale.id).expect(201);
      return { owner, report: report.body.data };
    }

    it('is queued rather than applied when support decides it', async () => {
      const { owner, report } = await almostSuspended();
      const support = await staff('SUPPORT');

      const res = await request(app)
        .post(api(`/reports/${report.id}/review`))
        .set('Cookie', support.cookie)
        .send({ verdict: 'CONFIRMED' })
        .expect(200);

      // Support can do their job; they cannot end an agency's month on their own
      // (review round 3, fix 4).
      expect(res.body.data.needsSuperApproval).toBe(true);

      const advertiser = await prisma.user.findUnique({ where: { id: owner.user.id } });
      expect(advertiser.fakeStrikes).toBe(3);
      expect(advertiser.status).toBe('ACTIVE');
    });

    it('appears in the super admin’s queue and suspends when approved', async () => {
      const { owner, report } = await almostSuspended();
      const support = await staff('SUPPORT');
      const superAdmin = await staff('SUPER_ADMIN');

      await request(app)
        .post(api(`/reports/${report.id}/review`))
        .set('Cookie', support.cookie)
        .send({ verdict: 'CONFIRMED' })
        .expect(200);

      const queue = await request(app)
        .get(api('/reports/pending-approval'))
        .set('Cookie', superAdmin.cookie)
        .expect(200);
      expect(queue.body.data.some((r) => r.id === report.id)).toBe(true);

      await request(app)
        .post(api(`/reports/${report.id}/approve-suspension`))
        .set('Cookie', superAdmin.cookie)
        .expect(200);

      const advertiser = await prisma.user.findUnique({ where: { id: owner.user.id } });
      expect(advertiser.status).toBe('SUSPENDED');
    });

    it('is applied at once when the super admin decides it directly', async () => {
      const { owner, report } = await almostSuspended();
      const superAdmin = await staff('SUPER_ADMIN');

      await request(app)
        .post(api(`/reports/${report.id}/review`))
        .set('Cookie', superAdmin.cookie)
        .send({ verdict: 'CONFIRMED' })
        .expect(200);

      const advertiser = await prisma.user.findUnique({ where: { id: owner.user.id } });
      expect(advertiser.status).toBe('SUSPENDED');
    });

    it('leaves the subscription alone', async () => {
      const { owner, report } = await almostSuspended();
      const superAdmin = await staff('SUPER_ADMIN');

      await request(app)
        .post(api(`/reports/${report.id}/review`))
        .set('Cookie', superAdmin.cookie)
        .send({ verdict: 'CONFIRMED' })
        .expect(200);

      // The account is suspended, not refunded and not cancelled
      // (blueprint decision 24).
      const live = await prisma.subscription.count({
        where: { userId: owner.user.id, status: 'ACTIVE' },
      });
      expect(live).toBe(1);
    });

    it('keeps the super admin queue closed to support', async () => {
      const support = await staff('SUPPORT');
      await request(app)
        .get(api('/reports/pending-approval'))
        .set('Cookie', support.cookie)
        .expect(403);
    });
  });

  describe('what the accused agency is told', () => {
    it('sees the strike but never who reported it', async () => {
      const { owner, reporter, havale } = await listingAndReporter();
      const support = await staff('SUPPORT');
      const report = await file(reporter.cookie, havale.id).expect(201);

      await request(app)
        .post(api(`/reports/${report.body.data.id}/review`))
        .set('Cookie', support.cookie)
        .send({ verdict: 'CONFIRMED' })
        .expect(200);

      const res = await request(app)
        .get(api('/reports/against-me'))
        .set('Cookie', owner.cookie)
        .expect(200);

      expect(res.body.data.strikes).toBe(1);
      expect(res.body.data.items).toHaveLength(1);
      // Naming the reporter would turn the feature into a way of finding out who
      // to lean on.
      const payload = JSON.stringify(res.body);
      expect(payload).not.toContain(reporter.user.agencyCode);
      expect(payload).not.toContain(reporter.user.username);
    });

    it('is notified rather than ambushed by the suspension', async () => {
      const { owner, reporter, havale } = await listingAndReporter();
      const support = await staff('SUPPORT');
      const report = await file(reporter.cookie, havale.id).expect(201);

      await request(app)
        .post(api(`/reports/${report.body.data.id}/review`))
        .set('Cookie', support.cookie)
        .send({ verdict: 'CONFIRMED' })
        .expect(200);

      const fresh = await prisma.violationReport.findUnique({
        where: { id: report.body.data.id },
      });
      expect(fresh.ownerNotifiedAt).not.toBeNull();

      // The SMS panel is off, so nothing is delivered — but the message is
      // recorded, which is what makes the notification path demonstrable now
      // (blueprint 8.5).
      const message = await prisma.smsMessage.findFirst({
        where: { userId: owner.user.id, template: 'VIOLATION_STRIKE' },
      });
      expect(message).not.toBeNull();
      expect(message.body).toContain('۱ از ۳');
    });
  });

  describe('tickets', () => {
    it('opens with its first message and shows it back', async () => {
      const { cookie } = await agent();

      const res = await request(app)
        .post(api('/tickets'))
        .set('Cookie', cookie)
        .send({ subject: 'تمدید اشتراک', body: 'می‌خواهم اشتراکم را تمدید کنم.' })
        .expect(201);

      expect(res.body.data.status).toBe('OPEN');
      expect(res.body.data.messages).toHaveLength(1);
    });

    // Filing a conversation under a subject is what makes the support queue
    // sortable — and what lets the agency start from «what do I need» rather
    // than from a blank box.
    it('files a conversation under its subject and filters the queue by it', async () => {
      const { cookie } = await agent();

      const made = await request(app)
        .post(api('/tickets'))
        .set('Cookie', cookie)
        .send({ subject: 'ظرفیت بیشتر', category: 'SEATS', body: 'می‌خواهم ظرفیت بخرم.' })
        .expect(201);
      expect(made.body.data.category).toBe('SEATS');

      // Not naming one is allowed and lands in «موضوع دیگر» rather than
      // failing — an agency in a hurry must never be blocked by a taxonomy.
      const plain = await request(app)
        .post(api('/tickets'))
        .set('Cookie', cookie)
        .send({ subject: 'یک سؤال', body: 'یک سؤال ساده دارم.' })
        .expect(201);
      expect(plain.body.data.category).toBe('OTHER');

      const seats = await request(app)
        .get(api('/tickets?category=SEATS'))
        .set('Cookie', cookie)
        .expect(200);
      const ids = seats.body.data.map((t) => t.id);
      expect(ids).toContain(made.body.data.id);
      expect(ids).not.toContain(plain.body.data.id);

      // The staff queue filters the same way, across agencies.
      const { cookie: staffCookie } = await staff('SUPPORT');
      const staffView = await request(app)
        .get(api('/tickets?category=SEATS'))
        .set('Cookie', staffCookie)
        .expect(200);
      expect(staffView.body.data.every((t) => t.category === 'SEATS')).toBe(true);
    });

    // A screenshot says in one image what a paragraph of «خطا می‌دهد» cannot.
    // The file is stored under a generated name and served only to people the
    // ticket itself is visible to.
    describe('attachments', () => {
      const png = Buffer.from(
        '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489' +
          '0000000d49444154789c626001000000ffff03000006000557bfabd4000000004945' +
          '4e44ae426082',
        'hex'
      );

      it('carries an image on the opening message and serves it back', async () => {
        const { cookie } = await agent();

        const res = await request(app)
          .post(api('/tickets'))
          .set('Cookie', cookie)
          .field('subject', 'خطای ثبت حواله')
          .field('body', 'تصویر خطا پیوست است.')
          .attach('files', png, 'اسکرین‌شات.png')
          .expect(201);

        const [attachment] = res.body.data.messages[0].attachments;
        expect(attachment.name).toBe('اسکرین‌شات.png');
        expect(attachment.mime).toBe('image/png');
        // The stored name is generated, never the uploaded one — a filename
        // used as a path is a traversal bug waiting for its first `../`.
        expect(attachment.url).not.toContain('اسکرین‌شات');

        await request(app).get(attachment.url).set('Cookie', cookie).expect(200);
      });

      it('serves it to staff and to nobody else', async () => {
        const owner = await agent();
        const stranger = await agent();
        const { cookie: staffCookie } = await staff('SUPPORT');

        const res = await request(app)
          .post(api('/tickets'))
          .set('Cookie', owner.cookie)
          .field('subject', 'پیوست خصوصی')
          .field('body', 'این فایل فقط برای پشتیبانی است.')
          .attach('files', png, 'private.png')
          .expect(201);
        const { url } = res.body.data.messages[0].attachments[0];

        await request(app).get(url).set('Cookie', staffCookie).expect(200);
        // Not-found rather than forbidden: another agency must not even learn
        // the attachment exists.
        await request(app).get(url).set('Cookie', stranger.cookie).expect(404);
      });

      it('refuses a type it does not accept, with a message that says so', async () => {
        const { cookie } = await agent();

        const res = await request(app)
          .post(api('/tickets'))
          .set('Cookie', cookie)
          .field('subject', 'فایل نامعتبر')
          .field('body', 'این فایل نباید قبول شود.')
          .attach('files', Buffer.from('#!/bin/sh\necho hi\n'), 'script.sh')
          .expect(400);

        expect(res.body.error.message).toContain('PDF');
      });
    });

    it('stays open to an agency whose subscription has lapsed', async () => {
      const { user, cookie } = await agent();
      await prisma.subscription.updateMany({
        where: { userId: user.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      // The most common reason to write is to arrange a renewal. Locking them
      // out of that channel is how an agency stops being a customer.
      await request(app)
        .post(api('/tickets'))
        .set('Cookie', cookie)
        .send({ subject: 'تمدید', body: 'چطور تمدید کنم؟' })
        .expect(201);
    });

    it('marks answered on a staff reply and reopens on the agent’s', async () => {
      const { cookie } = await agent();
      const support = await staff('SUPPORT');

      const ticket = await request(app)
        .post(api('/tickets'))
        .set('Cookie', cookie)
        .send({ subject: 'سؤال', body: 'یک سؤال دارم.' })
        .expect(201);

      const answered = await request(app)
        .post(api(`/tickets/${ticket.body.data.id}/messages`))
        .set('Cookie', support.cookie)
        .send({ body: 'پاسخ پشتیبانی' })
        .expect(200);
      expect(answered.body.data.status).toBe('ANSWERED');

      const reopened = await request(app)
        .post(api(`/tickets/${ticket.body.data.id}/messages`))
        .set('Cookie', cookie)
        .send({ body: 'هنوز حل نشده' })
        .expect(200);
      expect(reopened.body.data.status).toBe('OPEN');
    });

    it('signs staff replies as support, not by employee name', async () => {
      const { cookie } = await agent();
      const support = await staff('SUPPORT');

      const ticket = await request(app)
        .post(api('/tickets'))
        .set('Cookie', cookie)
        .send({ subject: 'سؤال', body: 'یک سؤال دارم.' })
        .expect(201);

      const res = await request(app)
        .post(api(`/tickets/${ticket.body.data.id}/messages`))
        .set('Cookie', support.cookie)
        .send({ body: 'پاسخ پشتیبانی' })
        .expect(200);

      // Naming the employee invites people to go around the system and contact
      // them directly.
      expect(res.body.data.messages[1].author).toBe('پشتیبانی');
      expect(JSON.stringify(res.body)).not.toContain(support.user.fullName);
    });

    it('never shows one agency another’s ticket', async () => {
      const first = await agent();
      const second = await agent();

      const ticket = await request(app)
        .post(api('/tickets'))
        .set('Cookie', first.cookie)
        .send({ subject: 'خصوصی', body: 'محتوای خصوصی' })
        .expect(201);

      await request(app)
        .get(api(`/tickets/${ticket.body.data.id}`))
        .set('Cookie', second.cookie)
        .expect(404);

      const list = await request(app).get(api('/tickets')).set('Cookie', second.cookie).expect(200);
      expect(list.body.data.some((t) => t.id === ticket.body.data.id)).toBe(false);
    });

    it('shows staff the whole queue', async () => {
      const { cookie } = await agent();
      const support = await staff('SUPPORT');

      const ticket = await request(app)
        .post(api('/tickets'))
        .set('Cookie', cookie)
        .send({ subject: 'در صف', body: 'محتوای تیکت' })
        .expect(201);

      const list = await request(app)
        .get(api('/tickets'))
        .set('Cookie', support.cookie)
        .expect(200);
      expect(list.body.data.some((t) => t.id === ticket.body.data.id)).toBe(true);
    });

    it('refuses a reply on a closed ticket', async () => {
      const { cookie } = await agent();

      const ticket = await request(app)
        .post(api('/tickets'))
        .set('Cookie', cookie)
        .send({ subject: 'بسته', body: 'محتوای تیکت' })
        .expect(201);

      await request(app)
        .put(api(`/tickets/${ticket.body.data.id}/status`))
        .set('Cookie', cookie)
        .send({ status: 'CLOSED' })
        .expect(200);

      // Otherwise a conversation continues under a status that says nobody is
      // looking at it.
      await request(app)
        .post(api(`/tickets/${ticket.body.data.id}/messages`))
        .set('Cookie', cookie)
        .send({ body: 'یک چیز دیگر' })
        .expect(400);
    });

    it('lets an agent close but not reopen', async () => {
      const { cookie } = await agent();

      const ticket = await request(app)
        .post(api('/tickets'))
        .set('Cookie', cookie)
        .send({ subject: 'بازگشایی', body: 'محتوای تیکت' })
        .expect(201);

      await request(app)
        .put(api(`/tickets/${ticket.body.data.id}/status`))
        .set('Cookie', cookie)
        .send({ status: 'CLOSED' })
        .expect(200);

      await request(app)
        .put(api(`/tickets/${ticket.body.data.id}/status`))
        .set('Cookie', cookie)
        .send({ status: 'OPEN' })
        .expect(400);
    });
  });

  /**
   * The notice box.
   *
   * Every moderation decision lands somewhere the agency cannot see: a listing
   * goes quiet, a counter goes up, and one day the account stops working. These
   * check that both sides of a verdict are told, in writing, with the facts
   * needed to argue about it — and that neither side learns who the other is.
   */
  describe('the agency notice box', () => {
    const review = (cookie, id, verdict, note = 'بررسی شد') =>
      request(app)
        .post(api(`/reports/${id}/review`))
        .set('Cookie', cookie)
        .send({ verdict, note });

    it('tells the accused which listing, on what grounds, and where that leaves them', async () => {
      const superAdmin = await staff('SUPER_ADMIN');
      const { owner, reporter, havale } = await listingAndReporter();

      const report = await file(reporter.cookie, havale.id).expect(201);
      await review(superAdmin.cookie, report.body.data.id, 'CONFIRMED', 'با کارخانه نخواند').expect(200);

      const box = await request(app).get(api('/notices')).set('Cookie', owner.cookie).expect(200);
      const strike = box.body.data.items.find((n) => n.kind === 'STRIKE');

      expect(strike).toBeDefined();
      expect(strike.listing.serial).toBe(havale.serial);
      expect(strike.reason).toBe('FAKE_LISTING');
      expect(strike.note).toBe('با کارخانه نخواند');
      // The number is the part that matters: «one of three» is a warning, an
      // unnumbered strike is only a scolding.
      expect(strike.strikeNumber).toBe(1);
      expect(strike.strikeLimit).toBeGreaterThan(1);
      expect(box.body.data.unread).toBeGreaterThan(0);
    });

    it('never names the agency that reported them', async () => {
      const superAdmin = await staff('SUPER_ADMIN');
      const { owner, reporter, havale } = await listingAndReporter();

      const report = await file(reporter.cookie, havale.id).expect(201);
      await review(superAdmin.cookie, report.body.data.id, 'CONFIRMED').expect(200);

      const box = await request(app).get(api('/notices')).set('Cookie', owner.cookie).expect(200);
      const serialised = JSON.stringify(box.body);

      // Telling an advertiser who reported them turns the feature into a way to
      // find out who to lean on.
      expect(serialised).not.toContain(reporter.user.agencyCode);
      expect(serialised).not.toContain(reporter.user.phone);
    });

    it('tells the reporter what came of the report they filed', async () => {
      const superAdmin = await staff('SUPER_ADMIN');
      const { reporter, havale } = await listingAndReporter();

      const report = await file(reporter.cookie, havale.id).expect(201);
      await review(superAdmin.cookie, report.body.data.id, 'REJECTED', 'شواهد کافی نبود').expect(200);

      const box = await request(app).get(api('/notices')).set('Cookie', reporter.cookie).expect(200);
      const outcome = box.body.data.items.find((n) => n.kind === 'REPORT_REJECTED');

      expect(outcome).toBeDefined();
      expect(outcome.note).toBe('شواهد کافی نبود');
    });

    it('says nothing about a report still waiting to be judged', async () => {
      const { owner, reporter, havale } = await listingAndReporter();
      await file(reporter.cookie, havale.id).expect(201);

      // Both sides: an open complaint is not a verdict, and announcing it would
      // be a penalty applied before the decision.
      for (const who of [owner, reporter]) {
        const box = await request(app).get(api('/notices')).set('Cookie', who.cookie).expect(200);
        expect(box.body.data.items).toHaveLength(0);
      }
    });

    it('stops counting as unread once the box has been opened', async () => {
      const superAdmin = await staff('SUPER_ADMIN');
      const { owner, reporter, havale } = await listingAndReporter();

      const report = await file(reporter.cookie, havale.id).expect(201);
      await review(superAdmin.cookie, report.body.data.id, 'CONFIRMED').expect(200);

      const before = await request(app).get(api('/notices/unread')).set('Cookie', owner.cookie).expect(200);
      expect(before.body.data.notices).toBe(1);

      await request(app).post(api('/notices/seen')).set('Cookie', owner.cookie).expect(200);

      const after = await request(app).get(api('/notices/unread')).set('Cookie', owner.cookie).expect(200);
      expect(after.body.data.notices).toBe(0);

      // Read is not deleted: the record is what they come back to when somebody
      // asks why a listing disappeared.
      const box = await request(app).get(api('/notices')).set('Cookie', owner.cookie).expect(200);
      expect(box.body.data.items).toHaveLength(1);
    });

    it('warns a buyer whose paid-for advertisement was changed afterwards', async () => {
      const { owner, reporter: viewer, havale } = await listingAndReporter();

      // Paying to see the contact is buying a particular set of facts.
      await request(app)
        .post(api(`/havales/${havale.id}/reveal`))
        .set('Cookie', viewer.cookie)
        .expect(200);

      const quiet = await request(app).get(api('/notices')).set('Cookie', viewer.cookie).expect(200);
      expect(quiet.body.data.items.some((n) => n.kind === 'LISTING_EDITED')).toBe(false);

      await request(app)
        .patch(api(`/havales/${havale.id}`))
        .set('Cookie', owner.cookie)
        .send({ amountToman: 12_000_000 })
        .expect(200);

      // The row looks exactly the same as an untouched one, so without this the
      // person who spent an allowance on it would be the last to know.
      const box = await request(app).get(api('/notices')).set('Cookie', viewer.cookie).expect(200);
      const changed = box.body.data.items.find((n) => n.kind === 'LISTING_EDITED');
      expect(changed).toBeDefined();
      expect(changed.listing.serial).toBe(havale.serial);
    });

    it('says nothing to somebody who saw the advertisement after it was edited', async () => {
      const { owner, reporter: viewer, havale } = await listingAndReporter();

      await request(app)
        .patch(api(`/havales/${havale.id}`))
        .set('Cookie', owner.cookie)
        .send({ amountToman: 12_000_000 })
        .expect(200);

      await request(app)
        .post(api(`/havales/${havale.id}/reveal`))
        .set('Cookie', viewer.cookie)
        .expect(200);

      // They bought the current version. Telling them it «changed» would be
      // noise about something that happened before they were involved.
      const box = await request(app).get(api('/notices')).set('Cookie', viewer.cookie).expect(200);
      expect(box.body.data.items.some((n) => n.kind === 'LISTING_EDITED')).toBe(false);
    });

    it('is still reachable after the account is suspended', async () => {
      const superAdmin = await staff('SUPER_ADMIN');
      const { owner } = await listingAndReporter();

      await request(app)
        .put(api(`/admin/agents/${owner.user.id}/status`))
        .set('Cookie', superAdmin.cookie)
        .send({ status: 'SUSPENDED' })
        .expect(200);

      // The whole point: the explanation for a suspension must not sit behind
      // the suspension. Signing back in is allowed, and the box opens.
      const back = await signIn(owner.user);
      const box = await request(app).get(api('/notices')).set('Cookie', back).expect(200);
      expect(box.body.data.items.some((n) => n.kind === 'ACCOUNT_SUSPENDED')).toBe(true);
    });
  });
});
