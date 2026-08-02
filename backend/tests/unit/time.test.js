const { startOfTehranDay, tehranOffsetMs } = require('../../src/utils/time');

/**
 * The daily reveal cap resets at midnight in Tehran. If it reset on the UTC day
 * it would reset at 03:30 local, so an agent working the evening would watch
 * their allowance disappear at 20:30 — and the bug report for that would be
 * "sometimes it says I have no views left", which is a bad afternoon.
 */
describe('Tehran calendar day', () => {
  it('is three and a half hours ahead of UTC', () => {
    expect(tehranOffsetMs(new Date('2026-08-02T12:00:00Z'))).toBe(3.5 * 60 * 60 * 1000);
  });

  it('starts at 20:30 UTC the previous day', () => {
    const midMorningInTehran = new Date('2026-08-02T06:00:00Z'); // 09:30 Tehran
    expect(startOfTehranDay(midMorningInTehran).toISOString()).toBe('2026-08-01T20:30:00.000Z');
  });

  it('puts 21:00 UTC in the next Tehran day, not the current UTC one', () => {
    // 21:00 UTC is 00:30 the following morning in Tehran: a new day for the cap,
    // even though UTC still calls it yesterday.
    const lateEvening = new Date('2026-08-02T21:00:00Z');
    expect(startOfTehranDay(lateEvening).toISOString()).toBe('2026-08-02T20:30:00.000Z');
  });

  it('gives the same start for every instant within one Tehran day', () => {
    const morning = startOfTehranDay(new Date('2026-08-02T05:00:00Z'));
    const evening = startOfTehranDay(new Date('2026-08-02T19:00:00Z'));
    expect(morning.getTime()).toBe(evening.getTime());
  });
});
