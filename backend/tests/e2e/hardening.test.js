const bcrypt = require('bcryptjs');
const request = require('supertest');

const app = require('../../src/app');
const { prisma } = require('../../src/config/database');
const {
  api,
  PASSWORD,
  signIn,
  signedInAgent,
  createAgent,
  giveSubscription,
  offer,
  cleanup,
} = require('../helpers/factory');

/**
 * The findings of the security review, each pinned by a test.
 *
 * Every case here is a hole that existed and was closed — written so that a
 * refactor which reopens one fails loudly rather than waiting for the next
 * review. The shape of each: what the attacker sends, what they must get.
 *
 * Needs a database:  RUN_E2E=1 npm run test:e2e
 */
const maybe = process.env.RUN_E2E ? describe : describe.skip;

maybe('hardening', () => {
  const created = [];
  const track = (u) => (created.push(u.id), u);

  const staff = async (role = 'SUPER_ADMIN') => {
    const tag = `${Date.now()}${Math.floor(Math.random() * 999)}`;
    const user = track(
      await prisma.user.create({
        data: {
          username: `test_hard_${role.toLowerCase()}_${tag}`,
          passwordHash: await bcrypt.hash(PASSWORD, 4),
          phone: `0918${tag.slice(-7)}`,
          fullName: 'کارمند تست',
          role,
          mustChangePassword: false,
        },
      })
    );
    return { user, cookie: await signIn(user) };
  };

  afterAll(async () => {
    await prisma.ticketMessage.deleteMany({ where: { authorId: { in: created } } });
    await prisma.ticket.deleteMany({ where: { userId: { in: created } } });
    await cleanup(created);
  });

  describe('admin agency endpoints reach agencies only', () => {
    it('refuses to reset another staff account’s password through /admin/agents', async () => {
      const admin = await staff('SUPER_ADMIN');
      const victim = await staff('SUPPORT');

      const res = await request(app)
        .put(api(`/admin/agents/${victim.user.id}/password`))
        .set('Cookie', admin.cookie)
        .send({ password: 'Hijacked@12345' });
      // Not found, not forbidden: an id that is not an agency does not exist
      // as far as this route is concerned.
      expect(res.status).toBe(404);

      // And the victim still signs in with their own password.
      const login = await request(app)
        .post(api('/auth/login'))
        .send({ username: victim.user.username, password: PASSWORD });
      expect(login.status).toBe(200);
    });

    it('refuses to suspend, edit or log out a staff account the same way', async () => {
      const admin = await staff('SUPER_ADMIN');
      const victim = await staff('SUPPORT');
      const id = victim.user.id;

      for (const call of [
        request(app).patch(api(`/admin/agents/${id}/status`)).send({ status: 'SUSPENDED' }),
        request(app).post(api(`/admin/agents/${id}/logout`)),
        request(app).put(api(`/admin/agents/${id}`)).send({ agencyName: 'x' }),
      ]) {
        // eslint-disable-next-line no-await-in-loop
        const res = await call.set('Cookie', admin.cookie);
        expect([404, 422]).toContain(res.status);
      }
      const still = await prisma.user.findUnique({ where: { id } });
      expect(still.status).toBe('ACTIVE');
    });
  });

  describe('writes must come from this site', () => {
    it('refuses a state-changing request whose Origin is another site', async () => {
      const res = await request(app)
        .post(api('/auth/login'))
        .set('Host', 'feranocar.test')
        .set('Origin', 'https://evil.example')
        .send({ username: 'nobody', password: 'x' });
      expect(res.status).toBe(403);
    });

    it('accepts the same request from its own origin, and from a non-browser', async () => {
      const own = await request(app)
        .post(api('/auth/login'))
        .set('Host', 'feranocar.test')
        .set('Origin', 'https://feranocar.test')
        .send({ username: 'nobody', password: 'x' });
      expect(own.status).toBe(401); // wrong password — the door itself is open

      const script = await request(app)
        .post(api('/auth/login'))
        .send({ username: 'nobody', password: 'x' });
      expect(script.status).toBe(401);
    });

    it('never blocks a read, whatever the Origin', async () => {
      const res = await request(app)
        .get(api('/health'))
        .set('Origin', 'https://evil.example');
      expect(res.status).toBe(200);
    });
  });

  describe('the API is never cached', () => {
    it('stamps no-store on an ordinary response', async () => {
      const { cookie } = await signedInAgent();
      created.push((await prisma.user.findFirst({ orderBy: { createdAt: 'desc' } })).id);
      const res = await request(app).get(api('/auth/me')).set('Cookie', cookie).expect(200);
      expect(res.headers['cache-control']).toBe('no-store');
    });
  });

  describe('uploads are what they claim to be', () => {
    it('refuses an HTML file dressed as a PNG', async () => {
      const { user, cookie } = await signedInAgent();
      track(user);
      const res = await request(app)
        .post(api('/tickets'))
        .set('Cookie', cookie)
        .field('subject', 'پیوست مشکوک')
        .field('body', 'این فایل عکس نیست و باید رد شود.')
        .attach('files', Buffer.from('<html><script>alert(1)</script></html>'), {
          filename: 'not-a-photo.png',
          contentType: 'image/png',
        });
      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('نمی‌خواند');
    });

    it('accepts a real PNG', async () => {
      const { user, cookie } = await signedInAgent();
      track(user);
      const png = Buffer.from(
        '89504e470d0a1a0a0000000d4948445200000001000000010806000000' +
          '1f15c4890000000d49444154789c626001000000ffff03000006000557' +
          'bfabd40000000049454e44ae426082',
        'hex'
      );
      const res = await request(app)
        .post(api('/tickets'))
        .set('Cookie', cookie)
        .field('subject', 'پیوست واقعی')
        .field('body', 'این یکی عکس واقعی است.')
        .attach('files', png, { filename: 'real.png', contentType: 'image/png' });
      expect(res.status).toBe(201);
    });
  });

  describe('allowances cannot be double-spent', () => {
    it('lets exactly the daily limit through when reveals race', async () => {
      const seller = track(await createAgent());
      await giveSubscription(seller);
      const sellerCookie = await signIn(seller);
      const ids = [];
      for (let i = 0; i < 4; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        const posted = await request(app)
          .post(api('/havales'))
          .set('Cookie', sellerCookie)
          // eslint-disable-next-line no-await-in-loop
          .send(await offer())
          .expect(201);
        ids.push(posted.body.data.id);
      }

      const viewer = track(await createAgent({ dailyRevealLimitOverride: 2 }));
      await giveSubscription(viewer);
      const cookie = await signIn(viewer);

      const results = await Promise.all(
        ids.map((id) => request(app).post(api(`/havales/${id}/reveal`)).set('Cookie', cookie))
      );
      const codes = results.map((r) => r.status).sort();
      expect(codes).toEqual([200, 200, 403, 403]);

      const spent = await prisma.contactReveal.count({ where: { viewerId: viewer.id } });
      expect(spent).toBe(2);
    });
  });

  describe('a reveal is pinned to its market', () => {
    it('refuses a حواله id sent to the خودرو reveal route', async () => {
      const seller = track(await createAgent());
      await giveSubscription(seller);
      const posted = await request(app)
        .post(api('/havales'))
        .set('Cookie', await signIn(seller))
        .send(await offer())
        .expect(201);

      const { user, cookie } = await signedInAgent();
      track(user);
      const res = await request(app)
        .post(api(`/cars/${posted.body.data.id}/reveal`))
        .set('Cookie', cookie);
      expect(res.status).toBe(404);
    });
  });

  describe('lockout is not a way to lock somebody else out', () => {
    it('five wrong guesses from one address do not lock the owner out at another', async () => {
      const victim = track(await createAgent());
      for (let i = 0; i < 5; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await request(app)
          .post(api('/auth/login'))
          .set('X-Forwarded-For', '203.0.113.9')
          .send({ username: victim.username, password: 'wrong' });
      }
      // The attacker's address is locked…
      const attacker = await request(app)
        .post(api('/auth/login'))
        .set('X-Forwarded-For', '203.0.113.9')
        .send({ username: victim.username, password: PASSWORD });
      expect(attacker.status).toBe(401);
      expect(attacker.body.error.message).toContain('قفل');

      // …and the owner, from home, is not.
      const owner = await request(app)
        .post(api('/auth/login'))
        .set('X-Forwarded-For', '198.51.100.20')
        .send({ username: victim.username, password: PASSWORD });
      expect(owner.status).toBe(200);
    });

    it('still locks the account outright under a distributed guessing run', async () => {
      const victim = track(await createAgent());
      for (let i = 0; i < 25; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await request(app)
          .post(api('/auth/login'))
          .set('X-Forwarded-For', `203.0.113.${i + 1}`)
          .send({ username: victim.username, password: 'wrong' });
      }
      const res = await request(app)
        .post(api('/auth/login'))
        .set('X-Forwarded-For', '198.51.100.20')
        .send({ username: victim.username, password: PASSWORD });
      expect(res.status).toBe(401);
      expect(res.body.error.message).toContain('قفل');
    });
  });

  describe('a suspended non-agency account stays out', () => {
    it('refuses a suspended developer at sign-in', async () => {
      const dev = await staff('DEVELOPER');
      await prisma.user.update({ where: { id: dev.user.id }, data: { status: 'SUSPENDED' } });
      const res = await request(app)
        .post(api('/auth/login'))
        .send({ username: dev.user.username, password: PASSWORD });
      expect(res.status).toBe(403);
    });
  });

  describe('the deposit slip is for the seats reviewer, not every staff role', () => {
    it('hides an order’s receipt from support staff', async () => {
      const support = await staff('SUPPORT');
      const res = await request(app)
        .get(api('/subscriptions/seat-orders/does-not-matter/receipt'))
        .set('Cookie', support.cookie);
      expect(res.status).toBe(404);
    });
  });
});
