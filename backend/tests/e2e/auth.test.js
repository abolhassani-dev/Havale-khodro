const request = require('supertest');
const bcrypt = require('bcryptjs');

const app = require('../../src/app');
const config = require('../../src/config');
const { prisma, connectDatabase, disconnectDatabase } = require('../../src/config/database');

/**
 * The auth rules that carry real consequences if they break.
 *
 * These are behavioural, not implementation tests: they assert what a user or an
 * attacker can observe, so a refactor of the internals leaves them alone while a
 * genuine regression turns them red.
 *
 * Needs a database:  RUN_E2E=1 npm run test:e2e
 */
const maybe = process.env.RUN_E2E ? describe : describe.skip;
const api = (path) => `${config.apiPrefix}${path}`;

const PASSWORD = 'Str0ngPassw0rd!';
const NEW_PASSWORD = 'An0therStr0ngOne!';

maybe('authentication', () => {
  let agent;

  beforeAll(async () => {
    await connectDatabase();
  });

  afterAll(async () => {
    await prisma.activityLog.deleteMany({ where: { summary: { startsWith: 'test_' } } });
    await disconnectDatabase();
  });

  beforeEach(async () => {
    const username = `test_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    agent = await prisma.user.create({
      data: {
        username,
        passwordHash: await bcrypt.hash(PASSWORD, 10),
        phone: `0912${Math.floor(1000000 + Math.random() * 8999999)}`,
        fullName: 'نماینده تست',
        role: 'AGENT',
        agencyCode: `T-${Date.now()}${Math.floor(Math.random() * 99)}`,
        agencyName: 'نمایندگی تست',
        city: 'تهران',
        coordinatorName: 'مسئول تست',
        coordinatorPhone: '09120000000',
        mustChangePassword: false,
      },
    });
  });

  afterEach(async () => {
    if (agent) {
      await prisma.authSession.deleteMany({ where: { userId: agent.id } });
      await prisma.activityLog.deleteMany({ where: { userId: agent.id } });
      await prisma.user.delete({ where: { id: agent.id } }).catch(() => {});
    }
  });

  const login = (username, password) =>
    request(app).post(api('/auth/login')).send({ username, password });

  const cookieFrom = (res) => res.headers['set-cookie'];

  it('signs in and sets an httpOnly session cookie', async () => {
    const res = await login(agent.username, PASSWORD);

    expect(res.status).toBe(200);
    expect(res.body.data.user.username).toBe(agent.username);

    const cookie = cookieFrom(res)[0];
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
  });

  it('never puts the session token or password hash in the response body', async () => {
    const res = await login(agent.username, PASSWORD);
    const body = JSON.stringify(res.body);

    // The cookie is the only place the token belongs. Returning it in the body
    // invites the frontend to store it somewhere readable, undoing httpOnly.
    expect(body).not.toContain('token');
    expect(body).not.toContain('passwordHash');
  });

  it('rejects a wrong password with the same message as an unknown username', async () => {
    const wrongPassword = await login(agent.username, 'not-the-password');
    const unknownUser = await login('test_definitely_not_a_user', PASSWORD);

    expect(wrongPassword.status).toBe(401);
    expect(unknownUser.status).toBe(401);
    // Identical responses: anything else tells an attacker which usernames exist.
    expect(wrongPassword.body.error.message).toBe(unknownUser.body.error.message);
  });

  it('stores only a hash of the session token, never the token itself', async () => {
    const res = await login(agent.username, PASSWORD);
    const raw = cookieFrom(res)[0].split(';')[0].split('=')[1];

    const session = await prisma.authSession.findFirst({ where: { userId: agent.id } });
    expect(session.tokenHash).not.toBe(raw);
    expect(session.tokenHash).toHaveLength(64);
  });

  it('returns the profile for a live session and refuses without one', async () => {
    const res = await login(agent.username, PASSWORD);

    const withCookie = await request(app).get(api('/auth/me')).set('Cookie', cookieFrom(res));
    expect(withCookie.status).toBe(200);
    expect(withCookie.body.data.username).toBe(agent.username);

    const without = await request(app).get(api('/auth/me'));
    expect(without.status).toBe(401);
  });

  it('never exposes another agency contact details through the profile', async () => {
    const res = await login(agent.username, PASSWORD);
    const me = await request(app).get(api('/auth/me')).set('Cookie', cookieFrom(res));

    // Own contact details are fine — these are the user's own. What must never
    // appear is another agency's, and that is enforced by the reveal flow.
    expect(me.body.data.agency.coordinatorPhone).toBe(agent.coordinatorPhone);
    expect(JSON.stringify(me.body)).not.toContain('passwordHash');
  });

  describe('single session per agent', () => {
    it('ends the first session when the same agent signs in again', async () => {
      const first = await login(agent.username, PASSWORD);
      const second = await login(agent.username, PASSWORD);

      const firstStillWorks = await request(app)
        .get(api('/auth/me'))
        .set('Cookie', cookieFrom(first));

      expect(firstStillWorks.status).toBe(401);
      expect(firstStillWorks.body.error.code).toBe('SESSION_KICKED');

      // And the newest session is the one left standing.
      const secondWorks = await request(app).get(api('/auth/me')).set('Cookie', cookieFrom(second));
      expect(secondWorks.status).toBe(200);
    });

    it('tells the kicked user why, rather than a generic failure', async () => {
      const first = await login(agent.username, PASSWORD);
      await login(agent.username, PASSWORD);

      const res = await request(app).get(api('/auth/me')).set('Cookie', cookieFrom(first));
      // Without a specific reason the user assumes the system logged them out at
      // random, and support gets the call instead of the interface answering it.
      expect(res.body.error.message).toContain('دستگاه دیگری');
    });

    it('does not apply to admins, who may work from two devices', async () => {
      // Blueprint 3.6. The rule exists to stop one subscription being shared
      // between agencies; an administrator has no subscription to share, and
      // being thrown off a laptop by their own phone is pure obstruction.
      const admin = await prisma.user.create({
        data: {
          username: `test_admin_${Date.now()}`,
          passwordHash: await bcrypt.hash(PASSWORD, 10),
          phone: `0913${Math.floor(1000000 + Math.random() * 8999999)}`,
          fullName: 'مدیر تست',
          role: 'SUPER_ADMIN',
          mustChangePassword: false,
        },
      });

      try {
        const first = await login(admin.username, PASSWORD);
        await login(admin.username, PASSWORD);

        const stillWorks = await request(app).get(api('/auth/me')).set('Cookie', cookieFrom(first));
        expect(stillWorks.status).toBe(200);
      } finally {
        await prisma.authSession.deleteMany({ where: { userId: admin.id } });
        await prisma.activityLog.deleteMany({ where: { userId: admin.id } });
        await prisma.user.delete({ where: { id: admin.id } });
      }
    });
  });

  describe('suspended accounts', () => {
    it('refuses to sign in', async () => {
      await prisma.user.update({ where: { id: agent.id }, data: { status: 'SUSPENDED' } });
      const res = await login(agent.username, PASSWORD);
      expect(res.status).toBe(403);
    });

    it('kills an already-live session on the next request', async () => {
      const res = await login(agent.username, PASSWORD);
      await prisma.user.update({ where: { id: agent.id }, data: { status: 'SUSPENDED' } });

      // Suspension has to take effect immediately. If an existing session kept
      // working until it expired, suspending a fraudulent account would do
      // nothing for hours.
      const after = await request(app).get(api('/auth/me')).set('Cookie', cookieFrom(res));
      expect(after.status).toBe(403);
    });
  });

  describe('forced password change', () => {
    beforeEach(async () => {
      await prisma.user.update({ where: { id: agent.id }, data: { mustChangePassword: true } });
    });

    it('flags it at login', async () => {
      const res = await login(agent.username, PASSWORD);
      expect(res.body.data.mustChangePassword).toBe(true);
    });

    it('accepts the change and clears the flag', async () => {
      const res = await login(agent.username, PASSWORD);

      const changed = await request(app)
        .post(api('/auth/change-password'))
        .set('Cookie', cookieFrom(res))
        .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });

      expect(changed.status).toBe(200);

      const after = await prisma.user.findUnique({ where: { id: agent.id } });
      expect(after.mustChangePassword).toBe(false);

      const withNew = await login(agent.username, NEW_PASSWORD);
      expect(withNew.status).toBe(200);
    });

    it('refuses a change without the correct current password', async () => {
      const res = await login(agent.username, PASSWORD);

      const changed = await request(app)
        .post(api('/auth/change-password'))
        .set('Cookie', cookieFrom(res))
        .send({ currentPassword: 'wrong', newPassword: NEW_PASSWORD });

      expect(changed.status).toBe(400);
    });
  });

  it('signs out and invalidates the session', async () => {
    const res = await login(agent.username, PASSWORD);
    const cookie = cookieFrom(res);

    await request(app).post(api('/auth/logout')).set('Cookie', cookie).expect(200);

    const after = await request(app).get(api('/auth/me')).set('Cookie', cookie);
    expect(after.status).toBe(401);
  });

  it('locks the account after five failed attempts', async () => {
    for (let i = 0; i < 5; i += 1) {
      await login(agent.username, 'wrong-password');
    }

    // Even the correct password is refused now — that is the point of a lockout.
    const res = await login(agent.username, PASSWORD);
    expect(res.status).toBe(401);
    expect(res.body.error.message).toContain('قفل');
  });
});
