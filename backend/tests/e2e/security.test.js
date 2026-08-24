const bcrypt = require('bcryptjs');
const request = require('supertest');

const app = require('../../src/app');
const { prisma, connectDatabase, disconnectDatabase } = require('../../src/config/database');
const { threats, THRESHOLDS } = require('../../src/middlewares/threatDetect');
const { api, PASSWORD, signIn, signedInAgent, cleanup } = require('../helpers/factory');

/**
 * The intrusion log.
 *
 * ── What is actually being tested ───────────────────────────────────────────
 *
 * Not that the attacks fail — they fail for reasons that have nothing to do
 * with this feature, and those reasons are tested elsewhere: Prisma binds every
 * parameter, `ui/html.js` escapes by default, Joi strips undeclared keys. What
 * is tested here is that when somebody tries, the owner can find out.
 *
 * The two failure modes worth guarding against are opposite and both fatal to
 * the feature. Silence — a probe that leaves no record — makes the log a
 * decoration. Noise — an ordinary Persian listing flagged as an attack — makes
 * it a page nobody reads, after which a real probe scrolls past unseen. So
 * every rule is tested from both sides.
 *
 * Needs a database:  RUN_E2E=1 npm run test:e2e
 */
const maybe = process.env.RUN_E2E ? describe : describe.skip;

maybe('the intrusion log', () => {
  const created = [];

  const owner = async () => {
    const tag = `${Date.now()}${Math.floor(Math.random() * 999)}`;
    const user = await prisma.user.create({
      data: {
        username: `test_secowner_${tag}`,
        passwordHash: await bcrypt.hash(PASSWORD, 4),
        phone: `0917${tag.slice(-7)}`,
        fullName: 'مالک تست',
        role: 'OWNER',
        mustChangePassword: false,
      },
    });
    created.push(user.id);
    return { user, cookie: await signIn(user) };
  };

  const staff = async (role = 'SUPER_ADMIN') => {
    const tag = `${Date.now()}${Math.floor(Math.random() * 999)}`;
    const user = await prisma.user.create({
      data: {
        username: `test_sec_${role.toLowerCase()}_${tag}`,
        passwordHash: await bcrypt.hash(PASSWORD, 4),
        phone: `0916${tag.slice(-7)}`,
        fullName: 'کارمند تست',
        role,
        mustChangePassword: false,
      },
    });
    created.push(user.id);
    return { user, cookie: await signIn(user) };
  };

  /**
   * Whatever was recorded for a rule, straight from the table.
   *
   * Polled rather than read once. Recording happens after the response is on
   * the wire — deliberately, so that attacking the server cannot also slow it
   * down — which means the row lands a moment after supertest's promise
   * resolves. Reading immediately would test the timing, not the behaviour.
   */
  const eventFor = async (rule, { expect: want = true } = {}) => {
    for (let i = 0; i < 40; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const row = await prisma.securityEvent.findFirst({
        where: { rule },
        orderBy: { lastSeen: 'desc' },
      });
      if (row || !want) return row;
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 25));
    }
    return null;
  };

  /** For the negative assertions: give it a moment, then confirm nothing came. */
  const noEventFor = async (rule) => {
    await new Promise((r) => setTimeout(r, 150));
    return prisma.securityEvent.findFirst({ where: { rule } });
  };

  const forget = (rule) => prisma.securityEvent.deleteMany({ where: { rule } });

  beforeAll(async () => {
    await connectDatabase();
  });

  afterAll(async () => {
    await cleanup(created);
    await prisma.securityEvent.deleteMany({ where: { ip: { in: ['::ffff:127.0.0.1', '127.0.0.1'] } } });
    await prisma.blockedIp.deleteMany({ where: { ip: { startsWith: '203.0.113.' } } });
    await disconnectDatabase();
  });

  beforeEach(() => threats.reset());

  describe('payloads in the URL', () => {
    const cases = [
      ['SQLI', "/havales?carType=' OR 1=1 --"],
      ['SQLI', '/havales?carType=1 UNION SELECT password FROM users'],
      ['TRAVERSAL', '/havales?carType=../../../../etc/passwd'],
      ['TRAVERSAL', '/havales?carType=%2e%2e%2f%2e%2e%2fetc%2fpasswd'],
      ['XSS', '/havales?carType=<script>alert(1)</script>'],
      ['CMDI', '/havales?carType=x;whoami'],
      ['SSRF', '/havales?carType=http://169.254.169.254/latest/meta-data'],
      ['HEADER_INJECT', '/havales?carType=x%0d%0aSet-Cookie:%20a=b'],
    ];

    it.each(cases)('records a %s attempt', async (rule, path) => {
      await forget(rule);
      await request(app).get(api(path));

      const event = await eventFor(rule);
      expect(event).toBeTruthy();
      expect(event.severity).toBeTruthy();
      expect(event.ip).toBeTruthy();
      // The record has to show what was sent, or it cannot be judged.
      expect(event.sample.length).toBeGreaterThan(0);
    });

    it('catches the encoded form as well as the plain one', async () => {
      // A scanner encodes precisely so that a naive check misses it. Both
      // spellings of «../../» are the same attempt and must record the same
      // way — this is asserted above by including both, and here by proving
      // the encoded one alone is enough.
      await forget('TRAVERSAL');
      await request(app).get(api('/havales?carType=%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd'));
      expect(await eventFor('TRAVERSAL')).toBeTruthy();
    });
  });

  describe('payloads in the body', () => {
    it('records a script tag submitted through a form', async () => {
      await forget('XSS');
      const agent = await signedInAgent();
      created.push(agent.user.id);

      await request(app)
        .post(api('/havales'))
        .set('Cookie', agent.cookie)
        .send({ kind: 'OFFER', description: '<script>fetch("//evil")</script>' });

      const event = await eventFor('XSS');
      expect(event).toBeTruthy();
      // Signed in, so the record names the account rather than only an address.
      expect(event.userId).toBe(agent.user.id);
    });

    it('records prototype pollution, which arrives as a key not a value', async () => {
      await forget('PROTO');
      // Sent as raw text, not as an object: `{ __proto__: … }` in JavaScript
      // sets the prototype instead of creating a key, so an object literal
      // would send nothing at all and the test would pass against a rule that
      // does not work.
      await request(app)
        .post(api('/auth/login'))
        .set('Content-Type', 'application/json')
        .send('{"username":"x","password":"y","__proto__":{"isAdmin":true}}');

      expect(await eventFor('PROTO')).toBeTruthy();
    });
  });

  describe('what must never be flagged', () => {
    it('leaves an ordinary Persian listing alone', async () => {
      // The whole feature is worthless if it cries wolf. These are the kinds of
      // things agencies really write.
      const before = await prisma.securityEvent.count();
      const agent = await signedInAgent();
      created.push(agent.user.id);

      for (const description of [
        'خودرو صفر، بدون رنگ و خط و خش — تحویل ۴۵ روزه',
        'قیمت مقطوع است. لطفاً چانه نزنید. شماره: در پیام',
        'شرایط: کد ملی بدون سابقه‌ی ثبت‌نام در ۴۸ ماه گذشته',
        'سلام؛ این حواله «صلح» است و مدارک کامل دارد.',
        'قیمت 950,000,000 تومان — 50% نقد و مابقی چک',
      ]) {
        // eslint-disable-next-line no-await-in-loop
        await request(app)
          .post(api('/havales'))
          .set('Cookie', agent.cookie)
          .send({ kind: 'OFFER', description });
      }

      expect(await prisma.securityEvent.count()).toBe(before);
    });

    it('leaves an ordinary search alone', async () => {
      const before = await prisma.securityEvent.count();
      await request(app).get(api('/havales?carType=پژو ۲۰۷&limit=20'));
      expect(await prisma.securityEvent.count()).toBe(before);
    });
  });

  describe('reconnaissance', () => {
    it('records a request for software this system does not run', async () => {
      await forget('PROBE_PATH');
      await request(app).get(api('/../wp-login.php'));
      await request(app).get(api('/x/.env'));
      expect(await eventFor('PROBE_PATH')).toBeTruthy();
    });

    it('records a scanner that names itself', async () => {
      await forget('SCANNER_UA');
      await request(app).get(api('/havales')).set('User-Agent', 'sqlmap/1.7#stable');

      const event = await eventFor('SCANNER_UA');
      expect(event).toBeTruthy();
      expect(event.sample).toContain('sqlmap');
    });

    it('leaves an ordinary browser alone', async () => {
      await forget('SCANNER_UA');
      await request(app)
        .get(api('/havales'))
        .set('User-Agent', 'Mozilla/5.0 (Linux; Android 13) Chrome/120 Mobile Safari/537.36');
      expect(await noEventFor('SCANNER_UA')).toBeNull();
    });
  });

  describe('guessing passwords', () => {
    it('says nothing about one wrong password, and reports a run of them', async () => {
      await forget('BRUTE_FORCE');
      const target = 'someones_account';

      for (let i = 1; i < THRESHOLDS.bruteForce; i += 1) threats.loginFailed(target);
      // Everyone mistypes a password. A log that reports that is a log nobody
      // reads by the second week.
      expect(await noEventFor('BRUTE_FORCE')).toBeNull();

      threats.loginFailed(target);
      const event = await eventFor('BRUTE_FORCE');
      expect(event).toBeTruthy();
      expect(event.sample).toContain(target);
    });

    it('reports spraying, which no per-account lockout would catch', async () => {
      // One password against many accounts never trips an account lockout —
      // and it is how real break-ins happen.
      await forget('PASSWORD_SPRAY');
      threats.reset();

      for (let i = 0; i < THRESHOLDS.spray; i += 1) threats.loginFailed(`victim_${i}`);

      expect(await eventFor('PASSWORD_SPRAY')).toBeTruthy();
    });

    it('does not call four attempts by one person a spray', async () => {
      await forget('PASSWORD_SPRAY');
      threats.reset();
      for (let i = 0; i < THRESHOLDS.spray + 3; i += 1) threats.loginFailed('one_forgetful_user');
      expect(await noEventFor('PASSWORD_SPRAY')).toBeNull();
    });
  });

  describe('sweeping', () => {
    it('reports identifiers tried one after another', async () => {
      await forget('NOT_FOUND_SWEEP');
      threats.reset();
      const req = { ip: '203.0.113.9', originalUrl: '/api/v1/havales/x', method: 'GET', headers: {} };

      for (let i = 0; i < THRESHOLDS.notFound - 1; i += 1) threats.notFound(req);
      expect(await noEventFor('NOT_FOUND_SWEEP')).toBeNull();

      threats.notFound(req);
      expect(await eventFor('NOT_FOUND_SWEEP')).toBeTruthy();
    });

    it('reports an account reaching where it may not go', async () => {
      await forget('FORBIDDEN_SWEEP');
      threats.reset();
      // A real account: the event names the user, and a foreign key that does
      // not resolve would make the write fail silently.
      const someone = await signedInAgent();
      created.push(someone.user.id);
      const req = {
        ip: '203.0.113.10',
        originalUrl: '/api/v1/admin/agents',
        method: 'GET',
        headers: {},
        user: { id: someone.user.id },
      };

      for (let i = 0; i < THRESHOLDS.forbidden; i += 1) threats.forbidden(req);
      expect(await eventFor('FORBIDDEN_SWEEP')).toBeTruthy();
    });
  });

  describe('one row per attack, not one per request', () => {
    it('counts a repeated probe instead of storing it again', async () => {
      // A scanner sends thousands of requests. A row for each would make the
      // attack that ought to be reported into the thing that fills the disk.
      await forget('SCANNER_UA');
      for (let i = 0; i < 12; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await request(app).get(api(`/havales?page=${i}`)).set('User-Agent', 'nikto/2.5');
      }

      await eventFor('SCANNER_UA');
      await new Promise((r) => setTimeout(r, 300));

      const rows = await prisma.securityEvent.findMany({ where: { rule: 'SCANNER_UA' } });
      expect(rows).toHaveLength(1);
      expect(rows[0].count).toBe(12);
      // And the row carries one of the attempts as an example. Deliberately not
      // asserted to be the last one: the writes are concurrent and whichever
      // commits last wins, which is a race the feature does not need to win.
      expect(rows[0].path).toMatch(/\/api\/v1\/havales\?page=\d+/);
    });
  });

  describe('who may read it', () => {
    it('is the owner’s alone', async () => {
      const admin = await staff('SUPER_ADMIN');
      await request(app).get(api('/security/events')).set('Cookie', admin.cookie).expect(403);

      const boss = await owner();
      const res = await request(app)
        .get(api('/security/events'))
        .set('Cookie', boss.cookie)
        .expect(200);

      expect(Array.isArray(res.body.data.items)).toBe(true);
      expect(res.body.data.summary).toHaveProperty('high');
      // The rule names come from the server, so the panel invents none.
      expect(res.body.data.rules.length).toBeGreaterThan(10);
      // Shown beside the block button, so nobody has to guess their own.
      expect(res.body.data.yourIp).toBeTruthy();
    });

    it('shows everything else the same address tried', async () => {
      const boss = await owner();
      await request(app).get(api('/havales')).set('User-Agent', 'nmap scripting engine');
      await request(app).get(api("/havales?carType=' OR 1=1 --"));

      const list = await request(app)
        .get(api('/security/events'))
        .set('Cookie', boss.cookie)
        .expect(200);

      const one = list.body.data.items[0];
      const detail = await request(app)
        .get(api(`/security/events/${one.id}`))
        .set('Cookie', boss.cookie)
        .expect(200);

      // The useful question about an attacker is what *else* they tried.
      expect(detail.body.data.alsoFrom.length).toBeGreaterThan(0);
      expect(detail.body.data.label).toBeTruthy();
      expect(detail.body.data.help).toBeTruthy();
    });
  });

  describe('closing the door', () => {
    it('blocks and unblocks an address', async () => {
      const boss = await owner();

      await request(app)
        .post(api('/security/blocks'))
        .set('Cookie', boss.cookie)
        .send({ ip: '203.0.113.77', reason: 'اسکن مداوم', days: 30 })
        .expect(200);

      expect(await prisma.blockedIp.findUnique({ where: { ip: '203.0.113.77' } })).toBeTruthy();

      await request(app)
        .delete(api('/security/blocks/203.0.113.77'))
        .set('Cookie', boss.cookie)
        .expect(200);

      expect(await prisma.blockedIp.findUnique({ where: { ip: '203.0.113.77' } })).toBeNull();
    });

    it('refuses to lock the door on the person holding the key', async () => {
      // Blocking runs before authentication, so the middleware cannot recognise
      // the owner and let them through. The only safe moment to catch this is
      // before it is written.
      const boss = await owner();
      const mine = await request(app)
        .get(api('/security/events'))
        .set('Cookie', boss.cookie)
        .expect(200);

      await request(app)
        .post(api('/security/blocks'))
        .set('Cookie', boss.cookie)
        .send({ ip: mine.body.data.yourIp })
        .expect(400);
    });
  });
});
