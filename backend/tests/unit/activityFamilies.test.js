const monitoringService = require('../../src/modules/admin/monitoring.service');
const { ACTION_PHRASES } = require('../../src/modules/admin/monitoring.service');
const { diffOf } = require('../../src/utils/diff');
const { describeDevice } = require('../../src/utils/requestContext');

/**
 * The parts of the log that fail silently.
 *
 * An action with no family is invisible to every filter — it is still written,
 * still in the table, and simply never comes back from a search. That is the
 * worst kind of defect in an audit trail, because it looks like the event did
 * not happen. So the mapping is asserted rather than trusted.
 */
describe('event families', () => {
  const families = monitoringService.families();

  it('publishes a family list for the panel to render', () => {
    expect(families.length).toBeGreaterThan(3);
    families.forEach((f) => {
      expect(typeof f.key).toBe('string');
      expect(f.label).toBeTruthy();
    });
  });

  it('puts every recorded action in exactly one family', () => {
    const seen = new Map();

    families.forEach((family) => {
      monitoringService.actionsOf(family.key).forEach((action) => {
        expect(seen.has(action)).toBe(false); // never in two families
        seen.set(action, family.key);
      });
    });

    // An action with a phrase but no family would be written, stored, and
    // never returned by any filter.
    expect(Object.keys(ACTION_PHRASES).filter((a) => !seen.has(a))).toEqual([]);
  });

  it('has a phrase for every action it groups', () => {
    // The other direction: a family listing an action nobody records would put
    // a dead option in the filter bar.
    families.forEach((family) => {
      monitoringService.actionsOf(family.key).forEach((action) => {
        expect(ACTION_PHRASES[action]).toBeTruthy();
      });
    });
  });
});

describe('what an edit changed', () => {
  const spec = {
    amountToman: ['مبلغ حواله', 'money'],
    carColor: ['رنگ'],
    description: ['توضیحات'],
  };

  it('records only the fields that actually moved', () => {
    const before = { amountToman: 50_000_000, carColor: 'سفید', description: 'الف' };
    const after = { amountToman: 80_000_000, carColor: 'سفید' };

    expect(diffOf(before, after, spec)).toEqual([
      { field: 'amountToman', label: 'مبلغ حواله', kind: 'money', from: 50_000_000, to: 80_000_000 },
    ]);
  });

  it('says nothing at all when nothing changed', () => {
    const row = { amountToman: 50_000_000, carColor: 'سفید' };
    expect(diffOf(row, { ...row }, spec)).toEqual([]);
  });

  it('does not mistake a Decimal for a change', () => {
    // Prisma hands money back as an object; the request body carries a number.
    // Comparing them with === reports every edit as changing every money field.
    const decimal = { toString: () => '50000000' };
    expect(diffOf({ amountToman: decimal }, { amountToman: 50_000_000 }, spec)).toEqual([]);
    expect(diffOf({ amountToman: decimal }, { amountToman: 60_000_000 }, spec)).toHaveLength(1);
  });

  it('turns BigInt money into a number', () => {
    // Money is BigInt in this schema; left alone it reaches the JSON column as
    // a string, so the same amount would read as "50000000" out and 50000000
    // in — a difference every screen would then have to paper over.
    const [change] = diffOf({ amountToman: 50000000n }, { amountToman: 80_000_000 }, spec);
    expect(change.from).toBe(50_000_000);
    expect(diffOf({ amountToman: 50000000n }, { amountToman: 50_000_000 }, spec)).toEqual([]);
  });

  it('treats empty and missing as the same absence', () => {
    expect(diffOf({ description: null }, { description: '' }, spec)).toEqual([]);
    expect(diffOf({ description: null }, { description: 'تازه' }, spec)).toHaveLength(1);
  });

  it('ignores fields the payload never mentioned', () => {
    expect(diffOf({ carColor: 'سفید' }, { amountToman: 1 }, spec)).toEqual([
      { field: 'amountToman', label: 'مبلغ حواله', kind: 'money', from: null, to: 1 },
    ]);
  });
});

describe('the device a log line records', () => {
  it('is short enough to store on every row', () => {
    const chrome =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
    expect(describeDevice(chrome)).toBe('دسکتاپ · Chrome');
  });

  it('does not label Chrome as Safari', () => {
    // Chrome's user agent contains the word Safari. Testing for Safari first
    // labels every Chrome in the country as Safari — the classic version of
    // this bug, and invisible until somebody is trying to match two sessions.
    const androidChrome =
      'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36';
    expect(describeDevice(androidChrome)).toBe('موبایل · Chrome');

    const iphone =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/604.1';
    expect(describeDevice(iphone)).toBe('موبایل · Safari');
  });

  it('is null when the request said nothing', () => {
    expect(describeDevice('')).toBeNull();
    expect(describeDevice(undefined)).toBeNull();
  });
});
