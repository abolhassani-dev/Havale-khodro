const fs = require('fs');
const path = require('path');

const { parsePage, headingProblem, toman, percent } = require('../../src/modules/carprice/carprice.parser');

/**
 * The parser against the two pages it was written from.
 *
 * These fixtures are the contract with the source. The counts, the ids and
 * the column headings below are facts about those files; when the source
 * changes its page, this is the test that says so — before an empty list
 * reaches an agency's screen.
 */
const fixture = (name) =>
  fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'car-prices', name), 'utf8');

describe('car price parser', () => {
  const domestic = parsePage(fixture('domestic.html'));
  const imported = parsePage(fixture('imported.html'));

  it('finds every car on both pages, each with the source’s stable id', () => {
    expect(domestic.items).toHaveLength(115);
    expect(imported.items).toHaveLength(134);
    for (const item of [...domestic.items, ...imported.items]) {
      expect(item.id).toMatch(/^\d+$/);
      expect(item.name).not.toBe('');
      expect(item.brand).not.toBe('');
    }
    const ids = new Set([...domestic.items, ...imported.items].map((i) => i.id));
    expect(ids.size).toBe(249);
  });

  it('reads the third column’s heading from the page — it differs between the two', () => {
    expect(domestic.secondLabel).toBe('قیمت کارخانه (تومان)');
    expect(imported.secondLabel).toBe('قیمت نمایندگی (تومان)');
  });

  it('keeps the page’s own timestamp, as text', () => {
    expect(domestic.stamp).toMatch(/۱۴۰۵/);
    expect(imported.stamp).toMatch(/۱۴۰۵/);
  });

  it('turns a row into toman, magnitude and percentage', () => {
    const arisan = domestic.items.find((i) => i.name === 'وانت آریسان');
    expect(arisan).toMatchObject({
      brand: 'ایران خودرو',
      id: '16025',
      priceToman: 1650000000n,
      secondToman: 1571900000n,
      changeToman: 45000000n,
      changePct: 2.8,
      direction: 'UP',
      sortOrder: 0,
    });
    expect(arisan.priceText).toBe('۱,۶۵۰,۰۰۰,۰۰۰');
  });

  it('keeps the words the source writes instead of a number, and never turns them into zero', () => {
    const ex30 = imported.items.find((i) => i.name === 'EX30');
    expect(ex30.priceToman).toBe(7600000000n);
    expect(ex30.secondToman).toBeNull();
    expect(ex30.secondText).toBe('---');

    const sahand = domestic.items.find((i) => i.name === 'سهند E اتوماتیک');
    expect(sahand.secondToman).toBeNull();
    expect(sahand.secondText).toBe('به زودی');

    const noPrice = domestic.items.filter((i) => i.priceToman === null);
    expect(noPrice.length).toBe(13);
    for (const item of noPrice) expect(item.priceText).not.toBe('');
  });

  it('reads no movement as FLAT, green as UP, and red with a minus as DOWN', () => {
    const soren = domestic.items.find((i) => i.name === 'سورن (TU5P)');
    expect(soren.changePct).toBe(0);
    expect(soren.changeToman).toBe(0n);
    expect(soren.direction).toBe('FLAT');

    expect(domestic.items.filter((i) => i.direction === 'UP')).toHaveLength(70);

    // The one fall on the page: «-۰.۷۹%» in red. The magnitude is kept
    // unsigned; the sign lives in `direction`.
    const downs = domestic.items.filter((i) => i.direction === 'DOWN');
    expect(downs).toHaveLength(1);
    expect(downs[0]).toMatchObject({
      id: '19323',
      name: 'X77 (الیت)',
      changePct: 0.79,
      changeToman: 42000000n,
      secondToman: null,
      secondText: 'توقف تولید',
    });
    expect(domestic.items.filter((i) => i.direction === null)).toHaveLength(0);
  });

  it('groups rows under the company heading above them, in the page’s order', () => {
    const brands = [...new Set(domestic.items.map((i) => i.brand))];
    expect(brands).toEqual(['ایران خودرو', 'سایپا', 'مدیران خودرو', 'کرمان موتور', 'بهمن موتور', 'سایر شرکت ها']);
    expect(imported.items.filter((i) => i.brand === 'تویوتا - Toyota')).toHaveLength(29);
    const orders = domestic.items.map((i) => i.sortOrder);
    expect(orders).toEqual(orders.map((_, n) => n));
  });

  it('answers an empty page, a page without the table, with no rows rather than a throw', () => {
    expect(parsePage('')).toEqual({ stamp: null, secondLabel: null, headings: null, items: [] });
    expect(parsePage('<html><body><h1>در حال به‌روزرسانی</h1></body></html>').items).toEqual([]);
  });

  it('knows which headings the numbers are stored under, and objects to any other', () => {
    expect(headingProblem(domestic.headings)).toBeNull();
    expect(headingProblem(imported.headings)).toBeNull();
    expect(headingProblem(null)).toMatch(/پیدا نشد/);
    expect(headingProblem(['نام خودرو', 'قیمت کارخانه (تومان)', 'قیمت بازار (تومان)', 'تغییر'])).toMatch(/ستون ۲|ستون 2/);
    expect(headingProblem(['نام خودرو', 'قیمت بازار (تومان)', 'قیمت پایه', 'تغییر'])).toMatch(/ستون 3/);
  });

  it('helpers: Persian digits, grouping and percentages', () => {
    expect(toman('۲۸,۵۰۰,۰۰۰,۰۰۰')).toBe(28500000000n);
    expect(toman('۰')).toBeNull();
    expect(toman('---')).toBeNull();
    expect(percent('( ۲.۸۰% )')).toBe(2.8);
    expect(percent('۰.۰۰%')).toBe(0);
    expect(percent('—')).toBeNull();
  });
});
