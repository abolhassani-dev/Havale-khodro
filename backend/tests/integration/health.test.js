const request = require('supertest');
const app = require('../../src/app');
const config = require('../../src/config');

describe('GET /health', () => {
  it('reports status and its dependency checks', async () => {
    const res = await request(app).get(`${config.apiPrefix}/health`);
    expect([200, 503]).toContain(res.status);
    expect(res.body.data).toHaveProperty('checks.database');
  });
});

describe('unknown routes', () => {
  it('returns a structured 404 rather than an HTML error page', async () => {
    const res = await request(app).get(`${config.apiPrefix}/definitely-not-a-route`);
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
