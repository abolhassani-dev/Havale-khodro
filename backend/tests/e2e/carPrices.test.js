const fs = require('fs');
const path = require('path');
const request = require('supertest');

const app = require('../../src/app');
const { prisma, connectDatabase, disconnectDatabase } = require('../../src/config/database');
const { api, signedInAgent, createAgent, signIn, cleanup } = require('../helpers/factory');
const carPriceService = require('../../src/modules/carprice/carprice.service');

/**
 * The market price list: the snapshot, the gate that protects it, and the
 * agency's own starred list.
 *
 * Needs a database:  RUN_E2E=1 npm run test:e2e
 */
const maybe = process.env.RUN_E2E ? describe : describe.skip;

const fixture = (name) =>
  fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'car-prices', name), 'utf8');

maybe('car prices', () => {
  const created = [];
  const domestic = fixture('domestic.html');
  const imported = fixture('imported.html');

  const agent = async (overrides) => {
    const signed = await signedInAgent(overrides);
    created.push(signed.user.id);
    return signed;
  };

  beforeAll(async () => {
    await connectDatabase();
    // A clean slate: these tables belong to this suite alone.
    await prisma.carPriceWatch.deleteMany();
    await prisma.carPriceHistory.deleteMany();
    await prisma.carPriceItem.deleteMany();
    await prisma.carPriceRun.deleteMany();
  });

  afterAll(async () => {
    await cleanup(created);
    await disconnectDatabase();
  });

  describe('refreshing from a page', () => {
    it('writes both groups and records a successful run for each', async () => {
      const a = await carPriceService.refresh('DOMESTIC', { html: domestic });
      const b = await carPriceService.refresh('IMPORTED', { html: imported });
      expect(a).toMatchObject({ ok: true, items: 115, newItems: 115, secondLabel: 'قیمت کارخانه (تومان)' });
      expect(b).toMatchObject({ ok: true, items: 134, newItems: 134, secondLabel: 'قیمت نمایندگی (تومان)' });

      expect(await prisma.carPriceItem.count()).toBe(249);
      // First sight of every car is a history point.
      expect(await prisma.carPriceHistory.count()).toBe(249);
      const runs = await prisma.carPriceRun.findMany({ where: { ok: true } });
      expect(runs).toHaveLength(2);
    });

    it('a second identical page changes nothing and adds no points', async () => {
      const r = await carPriceService.refresh('DOMESTIC', { html: domestic });
      expect(r.changed).toBe(0);
      expect(r.newItems).toBe(0);
      expect(await prisma.carPriceHistory.count()).toBe(249);
    });

    it('a moved price is noticed: direction from our own previous snapshot, and a point', async () => {
      // وانت آریسان, ۱,۶۵۰,۰۰۰,۰۰۰ in the fixture → lower it, colour untouched.
      const lowered = domestic.replace('۱,۶۵۰,۰۰۰,۰۰۰', '۱,۶۰۰,۰۰۰,۰۰۰');
      const r = await carPriceService.refresh('DOMESTIC', { html: lowered });
      expect(r.changed).toBe(1);

      const row = await prisma.carPriceItem.findUnique({ where: { id: '16025' } });
      expect(row.priceToman).toBe(1600000000n);
      expect(row.prevToman).toBe(1650000000n);
      expect(row.direction).toBe('DOWN');
      expect(row.changedAt).not.toBeNull();
      expect(await prisma.carPriceHistory.count({ where: { itemId: '16025' } })).toBe(2);

      // Back to the fixture, so the rest of the suite reads known numbers.
      await carPriceService.refresh('DOMESTIC', { html: domestic });
      const back = await prisma.carPriceItem.findUnique({ where: { id: '16025' } });
      expect(back.direction).toBe('UP');
    });

    it('refuses a page that is not the list, and leaves the previous snapshot alone', async () => {
      const before = await prisma.carPriceItem.count({ where: { group: 'DOMESTIC' } });
      const lastOk = await prisma.carPriceRun.findFirst({ where: { group: 'DOMESTIC', ok: true }, orderBy: { finishedAt: 'desc' } });

      await expect(
        carPriceService.refresh('DOMESTIC', { html: '<html><body>در حال به‌روزرسانی</body></html>' })
      ).rejects.toThrow(/سرستون/);
      // A page with a fraction of the rows is a broken page, not a small market.
      const cut = domestic.slice(0, domestic.indexOf('data-target="19348"'));
      await expect(carPriceService.refresh('DOMESTIC', { html: cut })).rejects.toThrow(/ردیف/);

      expect(await prisma.carPriceItem.count({ where: { group: 'DOMESTIC' } })).toBe(before);
      const failed = await prisma.carPriceRun.findMany({ where: { group: 'DOMESTIC', ok: false } });
      expect(failed.length).toBeGreaterThanOrEqual(2);
      for (const run of failed) expect(run.error).toMatch(/سر جایش ماند/);
      const stillLast = await prisma.carPriceRun.findFirst({ where: { group: 'DOMESTIC', ok: true }, orderBy: { finishedAt: 'desc' } });
      expect(stillLast.id).toBe(lastOk.id);
    });

    it('refuses a page whose columns are not what the numbers are stored as', async () => {
      // The factory column renamed to something else: read by position, that
      // page would store a wrong number under «قیمت بازار» — so it is refused.
      const moved = domestic.replace('قیمت بازار (تومان)', 'قیمت پایه (تومان)');
      await expect(carPriceService.refresh('DOMESTIC', { html: moved })).rejects.toThrow(/ساختار جدول/);
    });

    it('refuses a page where most rows carry no number', async () => {
      const blanked = domestic.replace(/<span class="lastprice">[۰-۹,]+<\/span><\/td>\s*<td>/g, '<span class="lastprice">---</span></td>  <td>');
      await expect(carPriceService.refresh('DOMESTIC', { html: blanked })).rejects.toThrow(/قیمت داشت/);
    });

    it('refuses a page whose prices all jumped — a unit change, not a market', async () => {
      // Every market price ×10: the kind of thing a switch to rial looks like.
      const tenfold = domestic.replace(/<span class="lastprice">([۰-۹,]+)<\/span>/g, (m, n) => `<span class="lastprice">${n}۰</span>`);
      await expect(carPriceService.refresh('DOMESTIC', { html: tenfold })).rejects.toThrow(/۳۰٪/);
      const row = await prisma.carPriceItem.findUnique({ where: { id: '16025' } });
      expect(row.priceToman).toBe(1650000000n);
    });

    it('a dry run judges the page and writes nothing', async () => {
      const runs = await prisma.carPriceRun.count();
      const r = await carPriceService.refresh('IMPORTED', { html: imported, dryRun: true });
      expect(r).toMatchObject({ ok: true, items: 134, dryRun: true });
      expect(await prisma.carPriceRun.count()).toBe(runs);
    });
  });

  describe('the panel’s view', () => {
    it('serves both groups with their own timestamp and heading, plus the agency’s stars', async () => {
      const { cookie } = await agent();
      const res = await request(app).get(api('/car-prices')).set('Cookie', cookie).expect(200);
      const { data } = res.body;

      expect(data.updatedAt).toBeTruthy();
      expect(data.stale).toBe(false);
      expect(data.groups.DOMESTIC.items).toHaveLength(115);
      expect(data.groups.IMPORTED.items).toHaveLength(134);
      expect(data.groups.DOMESTIC.secondLabel).toBe('قیمت کارخانه (تومان)');
      expect(data.groups.IMPORTED.secondLabel).toBe('قیمت نمایندگی (تومان)');
      expect(data.watching).toEqual([]);

      const first = data.groups.DOMESTIC.items[0];
      expect(first).toMatchObject({ id: '16025', name: 'وانت آریسان', brand: 'ایران خودرو', price: 1650000000, second: 1571900000 });
      // Numbers, not BigInt strings, and the words kept beside the nulls.
      const noPrice = data.groups.DOMESTIC.items.find((i) => i.price === null);
      expect(noPrice.priceText).not.toBe('');
      expect(res.headers['cache-control']).toMatch(/no-cache/);
    });

    it('is for signed-in agencies only, subscription or not', async () => {
      await request(app).get(api('/car-prices')).expect(401);
      const bare = await createAgent();
      created.push(bare.id);
      const cookie = await signIn(bare);
      await request(app).get(api('/car-prices')).set('Cookie', cookie).expect(200);
    });
  });

  describe('«فهرست من»', () => {
    it('stars and unstars, per agency, and refuses an id that is not a car', async () => {
      const { cookie } = await agent();
      let res = await request(app).post(api('/car-prices/watch/16025')).set('Cookie', cookie).expect(200);
      expect(res.body.data.watching).toEqual(['16025']);
      res = await request(app).post(api('/car-prices/watch/19350')).set('Cookie', cookie).expect(200);
      expect(res.body.data.watching.sort()).toEqual(['16025', '19350']);
      // Twice is still once.
      await request(app).post(api('/car-prices/watch/16025')).set('Cookie', cookie).expect(200);

      res = await request(app).get(api('/car-prices')).set('Cookie', cookie).expect(200);
      expect(res.body.data.watching.sort()).toEqual(['16025', '19350']);

      res = await request(app).delete(api('/car-prices/watch/16025')).set('Cookie', cookie).expect(200);
      expect(res.body.data.watching).toEqual(['19350']);

      await request(app).post(api('/car-prices/watch/1')).set('Cookie', cookie).expect(404);
      await request(app).post(api('/car-prices/watch/not-an-id')).set('Cookie', cookie).expect(404);

      // Another agency has its own list.
      const other = await agent();
      res = await request(app).get(api('/car-prices')).set('Cookie', other.cookie).expect(200);
      expect(res.body.data.watching).toEqual([]);
    });

    /**
     * The star is a private bookmark, not a notice board.
     *
     * It used to be kept under the parent's id, so a head office starring six
     * cars put them at the top of every branch's screen — and a branch
     * unstarring one took it away from everybody. Branches watch different
     * cars; each keeps its own list.
     */
    it('a branch of the same agency keeps its own list, separate from the parent’s', async () => {
      const parent = await agent();
      const branch = await agent({ parentId: parent.user.id });

      await request(app).post(api('/car-prices/watch/16025')).set('Cookie', parent.cookie).expect(200);

      const res = await request(app).get(api('/car-prices')).set('Cookie', branch.cookie).expect(200);
      expect(res.body.data.watching).toEqual([]);

      // And the branch's own star does not reach the parent either.
      await request(app).post(api('/car-prices/watch/19350')).set('Cookie', branch.cookie).expect(200);
      const back = await request(app).get(api('/car-prices')).set('Cookie', parent.cookie).expect(200);
      expect(back.body.data.watching).toEqual(['16025']);
    });
  });

  /**
   * The job runs in a container of its own every fifteen minutes, so the
   * in-process cooldown inside telegram.send never sees the previous run.
   * Without a mark that outlives the container, one broken source is
   * ninety-six notifications a day.
   */
  describe('how often a broken fetch is allowed to speak', () => {
    beforeEach(async () => {
      await prisma.setting.deleteMany({ where: { key: { startsWith: 'carPriceAlert:' } } });
    });

    it('says it once, then stays quiet until the cooldown is up', async () => {
      const now = new Date();
      expect(await carPriceService.shouldAlert('DOMESTIC', now)).toBe(true);
      expect(await carPriceService.shouldAlert('DOMESTIC', new Date(now.getTime() + 60 * 1000))).toBe(false);
      expect(
        await carPriceService.shouldAlert('DOMESTIC', new Date(now.getTime() + 4 * 60 * 60 * 1000))
      ).toBe(true);
    });

    it('speaks again for a fresh outage, however recently it last spoke', async () => {
      const now = new Date();
      expect(await carPriceService.shouldAlert('DOMESTIC', now)).toBe(true);
      // The source came back, and then broke again a minute later. That is
      // news, not a repeat, and waiting three hours to say so is wrong.
      await carPriceService.refresh('DOMESTIC', { html: domestic });
      expect(await carPriceService.shouldAlert('DOMESTIC', new Date(now.getTime() + 60 * 1000))).toBe(true);
    });

    it('one broken group does not silence the other', async () => {
      const now = new Date();
      expect(await carPriceService.shouldAlert('IMPORTED', now)).toBe(true);
      expect(await carPriceService.shouldAlert('DOMESTIC', now)).toBe(true);
    });
  });
});
