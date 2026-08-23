const request = require('supertest');

const app = require('../../src/app');
const { prisma, connectDatabase, disconnectDatabase } = require('../../src/config/database');
const {
  api,
  offer,
  purchaseRequest,
  createAgent,
  giveSubscription,
  signIn,
  signedInAgent,
  cleanup,
} = require('../helpers/factory');

/**
 * Listings, and the rule the business rests on: contact details are never in a
 * response the viewer has not paid for with a recorded reveal.
 *
 * Needs a database:  RUN_E2E=1 npm run test:e2e
 */
const maybe = process.env.RUN_E2E ? describe : describe.skip;

maybe('havale', () => {
  const created = [];

  /** Registers a user for cleanup and hands it straight back. */
  const track = (user) => {
    created.push(user.id);
    return user;
  };

  /** A signed-in agent with a live subscription, registered for cleanup. */
  const agent = async (overrides) => {
    const signed = await signedInAgent(overrides);
    created.push(signed.user.id);
    return signed;
  };

  beforeAll(async () => {
    await connectDatabase();
  });

  afterAll(async () => {
    await cleanup(created);
    await disconnectDatabase();
  });

  /** An owner with one live listing, and a separate agent to look at it. */
  async function twoAgentsAndAListing(listing) {
    const owner = await agent();
    const viewer = await agent();

    const res = await request(app)
      .post(api('/havales'))
      .set('Cookie', owner.cookie)
      .send(listing || (await offer()))
      .expect(201);

    return { owner, viewer, havale: res.body.data };
  }

  describe('contact masking', () => {
    /**
     * The single most important test in the project.
     *
     * If this ever goes red, every phone number in the database is readable by
     * anyone with a login and the browser's network tab — no cap consumed, no
     * audit row written. Hiding the number in the interface is not a substitute:
     * the interface runs on the attacker's machine.
     */
    it('never sends the phone number to someone who has not revealed it', async () => {
      const { owner, viewer, havale } = await twoAgentsAndAListing();

      const phone = owner.user.coordinatorPhone;
      expect(phone).toBeTruthy();

      const list = await request(app).get(api('/havales')).set('Cookie', viewer.cookie).expect(200);
      const detail = await request(app)
        .get(api(`/havales/${havale.id}`))
        .set('Cookie', viewer.cookie)
        .expect(200);

      // Searched in the raw payload, not in a parsed field: the point is that
      // the digits are not present anywhere, including somewhere nobody thought
      // to look.
      expect(JSON.stringify(list.body)).not.toContain(phone);
      expect(JSON.stringify(list.body)).not.toContain(owner.user.phone);
      expect(JSON.stringify(detail.body)).not.toContain(phone);
      expect(detail.body.data.contact).toBeNull();
      expect(detail.body.data.contactRevealed).toBe(false);
    });

    it('hides the poster identity — name, code, city — until the reveal is paid', async () => {
      // The agency's name is enough to find its switchboard in one web search,
      // which would turn "call them" into a free action outside the metering
      // and the audit log. So identity is confidential exactly like the phone.
      const { owner, viewer, havale } = await twoAgentsAndAListing();

      const before = await request(app)
        .get(api(`/havales/${havale.id}`))
        .set('Cookie', viewer.cookie)
        .expect(200);

      expect(before.body.data.agency).toBeNull();
      expect(before.body.data.contact).toBeNull();
      expect(JSON.stringify(before.body)).not.toContain(owner.user.agencyName);
      expect(JSON.stringify(before.body)).not.toContain(owner.user.agencyCode);

      await request(app)
        .post(api(`/havales/${havale.id}/reveal`))
        .set('Cookie', viewer.cookie)
        .expect(200);

      const after = await request(app)
        .get(api(`/havales/${havale.id}`))
        .set('Cookie', viewer.cookie)
        .expect(200);

      expect(after.body.data.agency.code).toBe(owner.user.agencyCode);
      expect(after.body.data.agency.city).toBe(owner.user.city);
      expect(after.body.data.contact.coordinatorPhone).toBe(owner.user.coordinatorPhone);
    });

    it('shows an expired subscription the market but no identity at all', async () => {
      const { owner } = await twoAgentsAndAListing();
      const broke = track(await createAgent());
      const cookie = await signIn(broke); // no subscription at all

      const res = await request(app).get(api('/havales')).set('Cookie', cookie).expect(200);
      const card = res.body.data.items.find((i) => !i.isOwn);

      expect(card).toBeDefined();
      expect(card.agency).toBeNull();
      expect(JSON.stringify(res.body)).not.toContain(owner.user.coordinatorPhone);
      expect(JSON.stringify(res.body)).not.toContain(owner.user.agencyName);
      // The listing itself is still there — an expired agency sees the market,
      // it just cannot reach anyone in it.
      expect(card.carType).toBeTruthy();
      expect(card.amountToman).toBeTruthy();
    });

    it('re-hides a contact that was revealed while the subscription was live', async () => {
      const { owner, viewer, havale } = await twoAgentsAndAListing();

      await request(app)
        .post(api(`/havales/${havale.id}/reveal`))
        .set('Cookie', viewer.cookie)
        .expect(200);

      // Expire the viewer's subscription with the reveal already on record.
      await prisma.subscription.updateMany({
        where: { userId: viewer.user.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const res = await request(app)
        .get(api(`/havales/${havale.id}`))
        .set('Cookie', viewer.cookie)
        .expect(200);

      // The check is on entitlement now, not on a past purchase. Otherwise an
      // agency could reveal a few hundred numbers in its last active week and
      // keep browsing them for free forever.
      expect(res.body.data.contact).toBeNull();
      expect(JSON.stringify(res.body)).not.toContain(owner.user.coordinatorPhone);
    });

    it('always shows an owner their own contact details', async () => {
      const { owner, havale } = await twoAgentsAndAListing();

      const res = await request(app)
        .get(api(`/havales/${havale.id}`))
        .set('Cookie', owner.cookie)
        .expect(200);

      expect(res.body.data.isOwn).toBe(true);
      expect(res.body.data.contact.coordinatorPhone).toBe(owner.user.coordinatorPhone);
    });
  });

  describe('revealing a contact', () => {
    it('returns the details and records who looked', async () => {
      const { owner, viewer, havale } = await twoAgentsAndAListing();

      const res = await request(app)
        .post(api(`/havales/${havale.id}/reveal`))
        .set('Cookie', viewer.cookie)
        .expect(200);

      expect(res.body.data.contact.coordinatorPhone).toBe(owner.user.coordinatorPhone);

      const reveal = await prisma.contactReveal.findFirst({
        where: { listingId: havale.id, viewerId: viewer.user.id },
      });
      expect(reveal).not.toBeNull();
      // The number as it read at that moment. Contact details can be corrected
      // later through a ticket; without this the log would show the new number
      // beside an old visit and the evidence would be worthless.
      expect(reveal.phoneShown).toBe(owner.user.coordinatorPhone);
      expect(reveal.agencyCodeShown).toBe(owner.user.agencyCode);
    });

    it('shows the owner the count but never who', async () => {
      const { owner, viewer, havale } = await twoAgentsAndAListing();

      await request(app)
        .post(api(`/havales/${havale.id}/reveal`))
        .set('Cookie', viewer.cookie)
        .expect(200);

      const res = await request(app)
        .get(api(`/havales/${havale.id}`))
        .set('Cookie', owner.cookie)
        .expect(200);

      expect(res.body.data.revealCount).toBe(1);
      // Knowing which agencies called would let the owner arrange the deal
      // outside the system (blueprint 6.9).
      expect(JSON.stringify(res.body)).not.toContain(viewer.user.agencyCode);
      expect(JSON.stringify(res.body)).not.toContain(viewer.user.username);
    });

    it('does not charge twice for the same listing', async () => {
      const { viewer, havale } = await twoAgentsAndAListing();

      const first = await request(app)
        .post(api(`/havales/${havale.id}/reveal`))
        .set('Cookie', viewer.cookie)
        .expect(200);
      const second = await request(app)
        .post(api(`/havales/${havale.id}/reveal`))
        .set('Cookie', viewer.cookie)
        .expect(200);

      expect(second.body.data.contact.coordinatorPhone).toBe(
        first.body.data.contact.coordinatorPhone
      );

      const rows = await prisma.contactReveal.count({
        where: { listingId: havale.id, viewerId: viewer.user.id },
      });
      // Closing the tab and coming back is not a second look.
      expect(rows).toBe(1);
      expect(second.body.data.usage.dailyUsed).toBe(1);
    });

    it('refuses when the daily cap is spent', async () => {
      const owner = await agent();
      const viewer = await agent({ dailyRevealLimitOverride: 1 });

      const ids = [];
      for (let i = 0; i < 2; i += 1) {
        const res = await request(app)
          .post(api('/havales'))
          .set('Cookie', owner.cookie)
          .send(await offer())
          .expect(201);
        ids.push(res.body.data.id);
      }

      await request(app)
        .post(api(`/havales/${ids[0]}/reveal`))
        .set('Cookie', viewer.cookie)
        .expect(200);

      const blocked = await request(app)
        .post(api(`/havales/${ids[1]}/reveal`))
        .set('Cookie', viewer.cookie)
        .expect(403);

      expect(blocked.body.error.code).toBe('REVEAL_LIMIT_REACHED');
      // And the number is not in the refusal either.
      expect(JSON.stringify(blocked.body)).not.toContain(owner.user.coordinatorPhone);
    });

    it('refuses on an expired subscription', async () => {
      const { owner, havale } = await twoAgentsAndAListing();
      const broke = track(await createAgent());
      const cookie = await signIn(broke);

      const res = await request(app)
        .post(api(`/havales/${havale.id}/reveal`))
        .set('Cookie', cookie)
        .expect(403);

      expect(res.body.error.code).toBe('SUBSCRIPTION_EXPIRED');
      expect(JSON.stringify(res.body)).not.toContain(owner.user.coordinatorPhone);
    });

    it('refuses on the agent’s own listing, so the counter cannot be inflated', async () => {
      const { owner, havale } = await twoAgentsAndAListing();

      await request(app)
        .post(api(`/havales/${havale.id}/reveal`))
        .set('Cookie', owner.cookie)
        .expect(400);

      const fresh = await prisma.listing.findUnique({ where: { id: havale.id } });
      expect(fresh.revealCount).toBe(0);
    });
  });

  describe('what an expired subscription may still do', () => {
    async function expiredOwnerWithListing() {
      const owner = await agent();
      const res = await request(app)
        .post(api('/havales'))
        .set('Cookie', owner.cookie)
        .send(await offer())
        .expect(201);

      await prisma.subscription.updateMany({
        where: { userId: owner.user.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      return { owner, havale: res.body.data };
    }

    it('cannot post, edit or renew', async () => {
      const { owner, havale } = await expiredOwnerWithListing();

      await request(app)
        .post(api('/havales'))
        .set('Cookie', owner.cookie)
        .send(await offer())
        .expect(403);

      await request(app)
        .patch(api(`/havales/${havale.id}`))
        .set('Cookie', owner.cookie)
        .send({ description: 'تغییر' })
        .expect(403);

      // Renewal ranks with posting. If it did not, an agency that stopped paying
      // would keep its listings at the top of the list with a weekly click
      // (blueprint 7.1).
      await request(app)
        .post(api(`/havales/${havale.id}/renew`))
        .set('Cookie', owner.cookie)
        .send({ deliveryDays: 60, depositDays: 5 })
        .expect(403);
    });

    it('can still close and delete its own listings', async () => {
      const { owner, havale } = await expiredOwnerWithListing();

      // Never blocked: an agency that has stopped paying must still be able to
      // take down a listing it can no longer honour.
      await request(app)
        .post(api(`/havales/${havale.id}/fulfill`))
        .set('Cookie', owner.cookie)
        .expect(200);

      await request(app)
        .delete(api(`/havales/${havale.id}`))
        .set('Cookie', owner.cookie)
        .expect(200);
    });
  });

  describe('numbered pages', () => {
    it('slices by page and reports the total, so a pager can be drawn', async () => {
      const { cookie } = await agent();
      const poster = await agent();
      for (let i = 0; i < 3; i += 1) {
        await request(app)
          .post(api('/havales'))
          .set('Cookie', poster.cookie)
          .send(await offer())
          .expect(201);
      }

      const page1 = await request(app)
        .get(api('/havales?page=1&limit=2'))
        .set('Cookie', cookie)
        .expect(200);

      expect(page1.body.data.items.length).toBeLessThanOrEqual(2);
      expect(page1.body.data.total).toBeGreaterThanOrEqual(3);
      expect(page1.body.data.pages).toBe(Math.ceil(page1.body.data.total / 2));

      // The second page continues where the first stopped — no overlap, no gap.
      const page2 = await request(app)
        .get(api('/havales?page=2&limit=2'))
        .set('Cookie', cookie)
        .expect(200);
      const ids1 = page1.body.data.items.map((h) => h.id);
      page2.body.data.items.forEach((h) => expect(ids1).not.toContain(h.id));
    });
  });

  describe('encryption at rest', () => {
    it('stores no readable phone number in the database', async () => {
      // The threat this addresses is a stolen dump — a backup that ended up
      // somewhere it should not have, a hosting-panel snapshot, a leaked
      // replica. None of those come with the server's .env, and without the
      // key these columns are noise. Read with $queryRaw deliberately: the
      // Prisma middleware decrypts, so any normal query would show plaintext
      // and prove nothing.
      const { user } = await agent();

      const [row] = await prisma.$queryRaw`
        SELECT phone, "coordinatorPhone", "phoneIndex" FROM "User" WHERE id = ${user.id}
      `;

      expect(row.phone).not.toContain(user.phone);
      expect(row.phone.startsWith('v1.')).toBe(true);
      expect(row.coordinatorPhone).not.toContain(user.coordinatorPhone);
      expect(row.phoneIndex).toBeTruthy();
      expect(row.phoneIndex).not.toContain(user.phone);

      // And the application still reads it back — encryption that broke the
      // product would be worse than none.
      const readBack = await prisma.user.findUnique({ where: { id: user.id } });
      expect(readBack.phone).toBe(user.phone);
      expect(readBack.coordinatorPhone).toBe(user.coordinatorPhone);
    });

    it('still finds an account by phone number', async () => {
      // An encrypted column cannot be searched; the blind index is what keeps
      // sign-in and duplicate detection working. If this breaks, registration
      // starts accepting the same number twice.
      const { user } = await agent();
      const found = await prisma.user.findUnique({ where: { phone: user.phone } });
      expect(found?.id).toBe(user.id);
    });

    it('records the revealed number encrypted too', async () => {
      const { owner, viewer, havale } = await twoAgentsAndAListing();
      await request(app)
        .post(api(`/havales/${havale.id}/reveal`))
        .set('Cookie', viewer.cookie)
        .expect(200);

      const [row] = await prisma.$queryRaw`
        SELECT "phoneShown" FROM "ContactReveal"
        WHERE "listingId" = ${havale.id} AND "viewerId" = ${viewer.user.id}
      `;
      expect(row.phoneShown).not.toContain(owner.user.coordinatorPhone);
      expect(row.phoneShown.startsWith('v1.')).toBe(true);
    });
  });

  describe('network filter', () => {
    it('lets a sub-agency see only its own network, and others cannot use it', async () => {
      const parent = await agent({ isReseller: true });
      const sub1 = await agent({ parentId: parent.user.id });
      const sub2 = await agent({ parentId: parent.user.id });
      const outsider = await agent();

      const post = async (who) => {
        const res = await request(app)
          .post(api('/havales'))
          .set('Cookie', who.cookie)
          .send(await offer())
          .expect(201);
        return res.body.data.id;
      };
      const insideId = await post(sub1);
      const outsideId = await post(outsider);

      // sub2 filters to its network: the colleague's listing is there, the
      // outsider's is not.
      const mine = await request(app)
        .get(api('/havales?network=mine&limit=50'))
        .set('Cookie', sub2.cookie)
        .expect(200);
      const ids = mine.body.data.items.map((h) => h.id);
      expect(ids).toContain(insideId);
      expect(ids).not.toContain(outsideId);

      // An account outside any network sends the same query and simply gets
      // the unfiltered list — the option belongs to networks only.
      const plain = await request(app)
        .get(api('/havales?network=mine&limit=50'))
        .set('Cookie', outsider.cookie)
        .expect(200);
      const plainIds = plain.body.data.items.map((h) => h.id);
      expect(plainIds).toContain(insideId);
      expect(plainIds).toContain(outsideId);
    });
  });

  describe('malformed and oversized requests', () => {
    it('answers a broken JSON body with 400, not 500, and does not name the parser', async () => {
      // From the OWASP pentest checklist, error handling: the body parser's own
      // message ("Expected property name…") names the framework, and a 500
      // treats a client mistake as a server bug — inflating the error log.
      const res = await request(app)
        .post(api('/auth/login'))
        .set('Content-Type', 'application/json')
        .send('{not valid json');

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).not.toMatch(/Expected property|JSON at position|SyntaxError/);
    });

    it('answers an oversized body with 413', async () => {
      const huge = 'a'.repeat(3 * 1024 * 1024); // over the 2mb limit
      const res = await request(app)
        .post(api('/auth/login'))
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ username: huge, password: 'x' }));

      expect(res.status).toBe(413);
    });
  });

  describe('listing rules', () => {
    it('requires colour and price on a sale but not on a request', async () => {
      const { cookie } = await agent();

      const { carColor, ...withoutColour } = await offer();
      expect(carColor).toBeTruthy();

      await request(app).post(api('/havales')).set('Cookie', cookie).send(withoutColour).expect(422);

      // A buyer who will take any colour should not have to invent one.
      await request(app)
        .post(api('/havales'))
        .set('Cookie', cookie)
        .send(await purchaseRequest())
        .expect(201);
    });

    it('rejects a paid amount larger than the total', async () => {
      const { cookie } = await agent();

      await request(app)
        .post(api('/havales'))
        .set('Cookie', cookie)
        .send(await offer({ paidAmountToman: 2_000_000_000 }))
        .expect(422);
    });

    it('closes a sale listing exactly when the deposit window does', async () => {
      const { cookie } = await agent();

      const res = await request(app)
        .post(api('/havales'))
        .set('Cookie', cookie)
        .send(await offer({ depositDays: 3 }))
        .expect(201);

      const days = (new Date(res.body.data.closesAt) - Date.now()) / (24 * 60 * 60 * 1000);
      expect(days).toBeGreaterThan(2.9);
      expect(days).toBeLessThan(3.1);
    });

    it('gives a purchase request seven days', async () => {
      const { cookie } = await agent();

      const res = await request(app)
        .post(api('/havales'))
        .set('Cookie', cookie)
        .send(await purchaseRequest())
        .expect(201);

      const days = (new Date(res.body.data.closesAt) - Date.now()) / (24 * 60 * 60 * 1000);
      expect(days).toBeGreaterThan(6.9);
      expect(days).toBeLessThan(7.1);
    });

    it('includes a colourless request when filtering by colour', async () => {
      const owner = await agent();
      await request(app)
        .post(api('/havales'))
        .set('Cookie', owner.cookie)
        .send(await purchaseRequest())
        .expect(201);

      const viewer = await agent();
      const res = await request(app)
        .get(api('/havales'))
        .query({ carColor: 'مشکی', kind: 'REQUEST' })
        .set('Cookie', viewer.cookie)
        .expect(200);

      // No colour on a request means "any colour will do" — it is the most
      // willing match in the list, so dropping it inverts its meaning
      // (review round 1, fix 7).
      const request2 = await purchaseRequest();
      const mine = res.body.data.items.filter((i) => i.carModelId === request2.carModelId);
      expect(mine.length).toBeGreaterThan(0);
    });

    it('hides a soft-deleted listing from agents but keeps the row', async () => {
      const { owner, viewer, havale } = await twoAgentsAndAListing();

      await request(app)
        .delete(api(`/havales/${havale.id}`))
        .set('Cookie', owner.cookie)
        .expect(200);

      await request(app)
        .get(api(`/havales/${havale.id}`))
        .set('Cookie', viewer.cookie)
        .expect(404);

      // Still on disk, with its reveal history and any violation reports —
      // otherwise deleting a listing would be a way to escape a report
      // (review round 3, fix 7).
      const row = await prisma.listing.findUnique({ where: { id: havale.id } });
      expect(row).not.toBeNull();
      expect(row.deletedAt).not.toBeNull();
    });

    it('takes a suspended agency’s listings down with the account', async () => {
      const { owner, viewer, havale } = await twoAgentsAndAListing();

      await prisma.user.update({ where: { id: owner.user.id }, data: { status: 'SUSPENDED' } });

      await request(app)
        .get(api(`/havales/${havale.id}`))
        .set('Cookie', viewer.cookie)
        .expect(404);

      const list = await request(app).get(api('/havales')).set('Cookie', viewer.cookie).expect(200);
      expect(list.body.data.items.some((i) => i.id === havale.id)).toBe(false);
    });

    it('answers 404, not 403, when an agent touches someone else’s listing', async () => {
      const { viewer, havale } = await twoAgentsAndAListing();

      // Telling a stranger "this exists but is not yours" hands them information
      // they did not have a moment ago.
      await request(app)
        .patch(api(`/havales/${havale.id}`))
        .set('Cookie', viewer.cookie)
        .send({ description: 'تغییر' })
        .expect(404);

      await request(app)
        .delete(api(`/havales/${havale.id}`))
        .set('Cookie', viewer.cookie)
        .expect(404);
    });

    it('renews from now and asks for the delivery time again', async () => {
      const owner = await agent();

      const res = await request(app)
        .post(api('/havales'))
        .set('Cookie', owner.cookie)
        .send(await offer({ depositDays: 2 }))
        .expect(201);

      const renewed = await request(app)
        .post(api(`/havales/${res.body.data.id}/renew`))
        .set('Cookie', owner.cookie)
        .send({ deliveryDays: 45, depositDays: 10 })
        .expect(200);

      // The delivery figure was quoted in days from the original posting date.
      // Carried over unchanged, after two renewals it describes a date in the
      // past (review round 1, fix 6).
      expect(renewed.body.data.deliveryDays).toBe(45);
      expect(renewed.body.data.renewCount).toBe(1);

      const days = (new Date(renewed.body.data.closesAt) - Date.now()) / (24 * 60 * 60 * 1000);
      expect(days).toBeGreaterThan(9.9);
    });
  });

  describe('sub-agent seats', () => {
    it('goes down with the parent’s subscription, without touching its own row', async () => {
      const parent = await agent();

      const child = track(await createAgent({ parentId: parent.user.id }));
      await giveSubscription(child, { origin: 'PARENT_SEAT', days: 365 });
      const childCookie = await signIn(child);

      // The seat's own row says it runs for a year. That must not matter:
      // storing the expiry on the sub-agent is what used to leave them locked
      // out after the parent renewed (review round 1, fix 1).
      await request(app)
        .post(api('/havales'))
        .set('Cookie', childCookie)
        .send(await purchaseRequest())
        .expect(201);

      await prisma.subscription.updateMany({
        where: { userId: parent.user.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      await request(app)
        .post(api('/havales'))
        .set('Cookie', childCookie)
        .send(await purchaseRequest())
        .expect(403);
    });

    /**
     * A central agency sees what its own agencies are working on.
     *
     * The widest thing anybody can ask for is their own family: `scope` is
     * honoured only for a reseller, and only over accounts whose parentId is
     * that very user. A child's row comes back marked `isOwn: false` so the
     * panel does not offer edit buttons the server would refuse.
     */
    it('lets a reseller see its own agencies’ listings, and nobody else’s', async () => {
      const parent = await agent({ isReseller: true });
      const child = track(await createAgent({ parentId: parent.user.id }));
      await giveSubscription(child, { origin: 'PARENT_SEAT', days: 365 });
      const childCookie = await signIn(child);

      const posted = await request(app)
        .post(api('/havales'))
        .set('Cookie', childCookie)
        .send(await purchaseRequest())
        .expect(201);

      const own = await request(app)
        .get(api('/havales/mine'))
        .set('Cookie', parent.cookie)
        .expect(200);
      expect(own.body.data.items.some((h) => h.id === posted.body.data.id)).toBe(false);

      const family = await request(app)
        .get(api('/havales/mine?scope=all'))
        .set('Cookie', parent.cookie)
        .expect(200);
      const row = family.body.data.items.find((h) => h.id === posted.body.data.id);
      expect(row).toBeTruthy();
      expect(row.isOwn).toBe(false);
      expect(row.agency.code).toBe(child.agencyCode);

      // The parent may open it in full, the way the owner sees it.
      const detail = await request(app)
        .get(api(`/havales/${posted.body.data.id}`))
        .set('Cookie', parent.cookie)
        .expect(200);
      expect(detail.body.data.contactRevealed).toBe(true);

      // An unrelated reseller asking for the same scope gets only its own.
      const stranger = await agent({ isReseller: true });
      const strangerList = await request(app)
        .get(api('/havales/mine?scope=all'))
        .set('Cookie', stranger.cookie)
        .expect(200);
      expect(strangerList.body.data.items.some((h) => h.id === posted.body.data.id)).toBe(false);
    });
  });
});
