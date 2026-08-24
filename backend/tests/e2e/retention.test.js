const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const { prisma, connectDatabase, disconnectDatabase } = require('../../src/config/database');
const config = require('../../src/config');
const { createAgent, cleanup } = require('../helpers/factory');

/**
 * Archive first, delete second.
 *
 * The property that matters is not «old rows go away» — that is one statement.
 * It is that a row can never leave the database without a readable copy of it
 * existing somewhere first, and that a half-written archive stops the delete
 * rather than being trusted. Both are asserted here by reading the archive back
 * off the disk, because a test that only checks the row count would pass
 * against a job that writes an empty file.
 *
 * Needs a database:  RUN_E2E=1 npm run test:e2e
 */
const maybe = process.env.RUN_E2E ? describe : describe.skip;

maybe('retention', () => {
  const created = [];
  let dir;
  let retentionService;

  /** Every line of every archive file, parsed. */
  const archived = async () => {
    const names = await fsp.readdir(dir).catch(() => []);
    const out = [];
    for (const name of names.filter((n) => n.endsWith('.ndjson.gz'))) {
      // eslint-disable-next-line no-await-in-loop
      const raw = zlib.gunzipSync(await fsp.readFile(path.join(dir, name))).toString('utf8');
      raw.split('\n').filter(Boolean).forEach((line) => out.push(JSON.parse(line)));
    }
    return out;
  };

  const oldEntry = (userId, action, daysAgo) =>
    prisma.activityLog.create({
      data: {
        userId,
        action,
        ip: '10.0.0.1',
        device: 'دسکتاپ · Chrome',
        createdAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
      },
    });

  beforeAll(async () => {
    await connectDatabase();
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'feranocar-archive-'));
    // Pointed at a temporary directory rather than the configured one: a test
    // must never write into the place a real deployment keeps its archive.
    config.retention.archiveDir = dir;
    // eslint-disable-next-line global-require
    retentionService = require('../../src/modules/admin/retention.service');
  });

  afterAll(async () => {
    await cleanup(created);
    await fsp.rm(dir, { recursive: true, force: true });
    await disconnectDatabase();
  });

  beforeEach(async () => {
    await Promise.all(
      (await fsp.readdir(dir)).map((n) => fsp.unlink(path.join(dir, n)).catch(() => {}))
    );
  });

  const agent = async () => {
    const user = await createAgent();
    created.push(user.id);
    return user;
  };

  it('writes a readable copy before it deletes anything', async () => {
    const user = await agent();
    const entry = await oldEntry(user.id, 'LOGIN_FAILED', config.retention.days.failedLogin + 5);

    await retentionService.run();

    expect(await prisma.activityLog.findUnique({ where: { id: entry.id } })).toBeNull();

    const lines = await archived();
    const line = lines.find((l) => l.id === entry.id);
    expect(line).toBeTruthy();
    expect(line.action).toBe('LOGIN_FAILED');
    expect(line.ip).toBe('10.0.0.1');
    expect(line.device).toBe('دسکتاپ · Chrome');
  });

  it('carries the agency name and code, not only an id', async () => {
    // The account may well be gone by the time anybody reads the archive, and
    // a bare user id resolves to nothing six months later.
    const user = await agent();
    const entry = await oldEntry(user.id, 'LOGIN', config.retention.days.auth + 5);

    await retentionService.run();

    const line = (await archived()).find((l) => l.id === entry.id);
    expect(line.agencyCode).toBe(user.agencyCode);
    expect(line.agencyName).toBe(user.agencyName);
  });

  it('keeps a reveal for good, however old', async () => {
    const user = await agent();
    const entry = await oldEntry(user.id, 'CONTACT_REVEALED', 5 * 365);

    await retentionService.run();

    // The record the whole masking design exists to produce. If this ever goes,
    // the system can no longer answer who saw whose number.
    expect(await prisma.activityLog.findUnique({ where: { id: entry.id } })).toBeTruthy();
    expect((await archived()).some((l) => l.id === entry.id)).toBe(false);
  });

  it('leaves anything still inside its window alone', async () => {
    const user = await agent();
    const recent = await oldEntry(user.id, 'LOGIN', 3);
    const listing = await oldEntry(user.id, 'HAVALE_CREATED', config.retention.days.auth + 5);

    await retentionService.run();

    expect(await prisma.activityLog.findUnique({ where: { id: recent.id } })).toBeTruthy();
    // A listing event outlives a sign-in: different window, same night.
    expect(await prisma.activityLog.findUnique({ where: { id: listing.id } })).toBeTruthy();
  });

  it('archives several groups into one night without overwriting the first', async () => {
    // Each group is a separate pass over the same file. Opening it with 'w'
    // instead of 'a' would leave only the last group's rows — and the earlier
    // ones would already have been deleted from the table by then.
    const user = await agent();
    const failed = await oldEntry(user.id, 'LOGIN_FAILED', config.retention.days.failedLogin + 5);
    const login = await oldEntry(user.id, 'LOGIN', config.retention.days.auth + 5);
    const admin = await oldEntry(user.id, 'AGENT_SUSPENDED', config.retention.days.admin + 5);

    await retentionService.run();

    const ids = (await archived()).map((l) => l.id);
    expect(ids).toContain(failed.id);
    expect(ids).toContain(login.id);
    expect(ids).toContain(admin.id);
    expect(await prisma.activityLog.count({ where: { id: { in: ids } } })).toBe(0);
  });

  it('changes nothing on a dry run, and still says what is due', async () => {
    const user = await agent();
    const entry = await oldEntry(user.id, 'LOGIN_FAILED', config.retention.days.failedLogin + 5);

    const report = await retentionService.run({ dryRun: true });

    expect(report.dryRun).toBe(true);
    expect(report.groups.find((g) => g.name === 'ورود ناموفق').due).toBeGreaterThan(0);
    expect(await prisma.activityLog.findUnique({ where: { id: entry.id } })).toBeTruthy();
    expect(await archived()).toEqual([]);
  });

  it('refuses to delete when the archive came up short', async () => {
    // The whole safety property, forced: the archive writes fewer rows than
    // were counted. Nothing may be deleted on a maybe.
    const user = await agent();
    const entry = await oldEntry(user.id, 'LOGIN_FAILED', config.retention.days.failedLogin + 5);

    const real = retentionService.archive;
    retentionService.archive = async () => 0;
    let report;
    try {
      report = await retentionService.run();
    } finally {
      retentionService.archive = real;
    }

    expect(report.groups.find((g) => g.name === 'ورود ناموفق').skipped).toBe(true);
    expect(report.deleted).toBe(0);
    expect(await prisma.activityLog.findUnique({ where: { id: entry.id } })).toBeTruthy();
  });

  it('removes archive files past their own lifetime, and no others', async () => {
    const old = path.join(dir, 'activity-2000-01-01.ndjson.gz');
    const fresh = path.join(dir, `activity-${new Date().toISOString().slice(0, 10)}.ndjson.gz`);
    fs.writeFileSync(old, zlib.gzipSync('{}\n'));
    fs.writeFileSync(fresh, zlib.gzipSync('{}\n'));

    const removed = await retentionService.forgetOldArchives();

    expect(removed).toBe(1);
    expect(fs.existsSync(old)).toBe(false);
    expect(fs.existsSync(fresh)).toBe(true);
  });
});
