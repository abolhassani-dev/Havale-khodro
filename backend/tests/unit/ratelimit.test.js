const request = require('supertest');
const rateLimit = require('express-rate-limit');
const express = require('express');
const cookieParser = require('cookie-parser');

// The real limiter cannot be exercised through the app because config.isTest
// disables it — deliberately, so 141 tests do not trip it. So the same options
// are mounted on a bare app here and driven directly.
function build({ skipSuccessfulRequests = false, max = 3, keyGenerator } = {}) {
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use(rateLimit({ windowMs: 60_000, max, skipSuccessfulRequests, keyGenerator,
    standardHeaders: true, legacyHeaders: false }));
  app.post('/login', (req, res) =>
    req.body.password === 'right' ? res.json({ ok: true }) : res.status(401).json({ ok: false }));
  app.get('/x', (_req, res) => res.json({ ok: true }));
  return app;
}

describe('rate limiting behaviour', () => {
  it('OLD: counting successes locks out someone signing in repeatedly', async () => {
    const app = build({ skipSuccessfulRequests: false, max: 3 });
    const codes = [];
    for (let i = 0; i < 5; i += 1) {
      const r = await request(app).post('/login').send({ password: 'right' });
      codes.push(r.status);
    }
    // This is the bug the owner hit: four correct sign-ins, then locked out.
    expect(codes).toContain(429);
  });

  it('NEW: successful sign-ins never count, so a real person is never locked out', async () => {
    const app = build({ skipSuccessfulRequests: true, max: 3 });
    const codes = [];
    for (let i = 0; i < 12; i += 1) {
      const r = await request(app).post('/login').send({ password: 'right' });
      codes.push(r.status);
    }
    expect(codes.every((c) => c === 200)).toBe(true);
  });

  it('NEW: failed guesses are still stopped', async () => {
    const app = build({ skipSuccessfulRequests: true, max: 3 });
    const codes = [];
    for (let i = 0; i < 8; i += 1) {
      const r = await request(app).post('/login').send({ password: 'wrong' });
      codes.push(r.status);
    }
    expect(codes.filter((c) => c === 429).length).toBeGreaterThan(0);
  });

  it('keys by session so one office connection is not a single shared budget', async () => {
    const app = build({ max: 3, keyGenerator: (req) =>
      req.cookies?.sid ? `s:${req.cookies.sid}` : `ip:${req.ip}` });

    for (let i = 0; i < 4; i += 1) await request(app).get('/x').set('Cookie', 'sid=userA');
    // Same address, different session: must still be served.
    const other = await request(app).get('/x').set('Cookie', 'sid=userB');
    expect(other.status).toBe(200);
  });
});
