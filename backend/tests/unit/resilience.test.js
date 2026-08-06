/**
 * The behaviour that decides whether a database restart is an outage.
 *
 * Postgres restarts on its own — a backup, an upgrade, the kernel reclaiming
 * memory. What matters is what the application does during the few seconds it
 * is away. These tests pin down both halves of the answer, including the half
 * that must NOT happen: a retried write would duplicate a havale.
 */

// A stand-in for PrismaClient, so the retry logic can be handed failures on
// demand. The real client would need a database, and a test that needs the
// thing being tested to be healthy cannot test what happens when it is not.
const mockMiddlewares = [];
const mockConnect = jest.fn();

jest.mock('@prisma/client', () => ({
  PrismaClient: class {
    constructor() {
      this.$use = (fn) => mockMiddlewares.push(fn);
      this.$connect = mockConnect;
      this.$disconnect = jest.fn();
    }
  },
}));

const { connectDatabase } = require('../../src/config/database');

/** The retry middleware is registered first, so it wraps everything else. */
const retryMiddleware = mockMiddlewares[0];

/** Runs one query through the retry middleware with a scripted `next`. */
const run = (params, next) => retryMiddleware(params, next);

const connectionError = (code) => Object.assign(new Error(`connection lost (${code})`), { code });

beforeEach(() => mockConnect.mockReset());

describe('connecting when the database is not ready yet', () => {
  it('waits and succeeds rather than exiting the process', async () => {
    mockConnect
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(undefined);

    await expect(connectDatabase({ retries: 5, baseDelayMs: 1 })).resolves.toBeUndefined();
    expect(mockConnect).toHaveBeenCalledTimes(3);
  });

  it('gives up eventually — a database that never answers is not a startup delay', async () => {
    mockConnect.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(connectDatabase({ retries: 3, baseDelayMs: 1 })).rejects.toThrow('ECONNREFUSED');
    expect(mockConnect).toHaveBeenCalledTimes(3);
  });
});

describe('a read whose connection dropped', () => {
  it('is retried and returns the answer', async () => {
    const next = jest
      .fn()
      .mockRejectedValueOnce(connectionError('P1017'))
      .mockResolvedValueOnce([{ id: 'havale-1' }]);

    const result = await run({ model: 'Havale', action: 'findMany' }, next);

    expect(result).toEqual([{ id: 'havale-1' }]);
    expect(next).toHaveBeenCalledTimes(2);
  });

  it('gives up after three attempts and surfaces the error', async () => {
    const next = jest.fn().mockRejectedValue(connectionError('P1001'));

    await expect(run({ model: 'User', action: 'findUnique' }, next)).rejects.toMatchObject({
      code: 'P1001',
    });
    expect(next).toHaveBeenCalledTimes(3);
  });
});

describe('what must not be retried', () => {
  // The whole reason the retry is scoped to reads. A create that committed
  // just before the connection dropped looks identical, from here, to one that
  // did not — and replaying it puts a second havale in front of the customer.
  it('never replays a write, even on a connection error', async () => {
    const next = jest.fn().mockRejectedValue(connectionError('P1017'));

    await expect(run({ model: 'Havale', action: 'create' }, next)).rejects.toMatchObject({
      code: 'P1017',
    });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['update', 'P1017'],
    ['delete', 'P1001'],
    ['upsert', 'P1017'],
  ])('never replays %s', async (action, code) => {
    const next = jest.fn().mockRejectedValue(connectionError(code));

    await expect(run({ model: 'Havale', action }, next)).rejects.toMatchObject({ code });
    expect(next).toHaveBeenCalledTimes(1);
  });

  // A unique-constraint violation is a real answer. Retrying it would turn an
  // instant, correct "this code is taken" into three attempts and the same
  // message, and would hide a genuine bug behind a delay.
  it('does not retry an error that is the database answering', async () => {
    const next = jest.fn().mockRejectedValue(connectionError('P2002'));

    await expect(run({ model: 'User', action: 'findMany' }, next)).rejects.toMatchObject({
      code: 'P2002',
    });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('passes a successful read straight through, untouched', async () => {
    const next = jest.fn().mockResolvedValue([{ id: 'x' }]);

    await expect(run({ model: 'User', action: 'findMany' }, next)).resolves.toEqual([{ id: 'x' }]);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
