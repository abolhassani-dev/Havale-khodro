const {
  deriveGrade,
  bodyStatusError,
  currentJalaliYear,
  BODY_PARTS,
} = require('../../src/modules/car/car.constants');

/**
 * The body table's two pure rules: what counts as a valid table, and which
 * one-word grade a table collapses into. The grade is what buyers filter by,
 * so a wrong ladder here is a car sold as something it is not.
 */
describe('car body vocabulary', () => {
  describe('deriveGrade', () => {
    it('an empty table is «بدون رنگ»', () => {
      expect(deriveGrade(null)).toBe('NO_PAINT');
      expect(deriveGrade({})).toBe('NO_PAINT');
    });

    it('a touch-up or overspray is «رنگ جزئی»', () => {
      expect(deriveGrade({ 'fnd-f-d': 'PARTIAL' })).toBe('MINOR_PAINT');
      expect(deriveGrade({ hood: 'SPRAY' })).toBe('MINOR_PAINT');
    });

    it('a fully painted panel is «رنگ‌شده», outranking touch-ups', () => {
      expect(deriveGrade({ 'fnd-f-d': 'PARTIAL', hood: 'PAINT' })).toBe('PAINTED');
    });

    it('a replaced panel is «تعویض‌دار», outranking paint', () => {
      expect(deriveGrade({ hood: 'PAINT', 'dr-f-d': 'REPLACE' })).toBe('REPLACED');
    });

    it('any chassis damage is «شاسی‌خورده», outranking everything', () => {
      expect(deriveGrade({ 'dr-f-d': 'REPLACE', 'chs-f-d': 'DAMAGE' })).toBe('CHASSIS_DAMAGED');
      expect(deriveGrade({ 'rl-r-p': 'PAINT' })).toBe('CHASSIS_DAMAGED');
    });

    it('overspray on a chassis part does not make a car شاسی‌خورده', () => {
      // Overspray reaches the rails from painting the panel above them; it is
      // paint evidence, not structural damage.
      expect(deriveGrade({ 'chs-f-d': 'SPRAY' })).toBe('MINOR_PAINT');
    });
  });

  describe('bodyStatusError', () => {
    it('accepts nothing marked, and any valid combination', () => {
      expect(bodyStatusError(null)).toBeNull();
      expect(bodyStatusError({})).toBeNull();
      expect(bodyStatusError({ hood: 'PAINT', 'chs-f-d': 'DAMAGE', 'sill-r': 'REPLACE' })).toBeNull();
    });

    it('refuses a part that does not exist — never silently drops it', () => {
      expect(bodyStatusError({ spoiler: 'PAINT' })).toMatch(/ناشناخته/);
    });

    it('refuses a condition the part class does not accept', () => {
      // رنگ جزئی is a panel word; a chassis rail is not painted panel-deep.
      expect(bodyStatusError({ 'chs-f-d': 'PARTIAL' })).toMatch(/مجاز نیست/);
      expect(bodyStatusError({ 'rl-f-d': 'SPRAY' })).toMatch(/مجاز نیست/);
      // آسیب جزئی is a chassis word; a door is dented, not «آسیب جزئی».
      expect(bodyStatusError({ 'dr-f-d': 'DAMAGE' })).toMatch(/مجاز نیست/);
    });

    it('refuses shapes that are not a table at all', () => {
      expect(bodyStatusError([])).toMatch(/معتبر نیست/);
      expect(bodyStatusError('hood:PAINT')).toMatch(/معتبر نیست/);
    });

    it('refuses a part the shape does not have, and only for that shape', () => {
      // A single cab has one door a side; a rear door on one is a claim about
      // a panel the car never had.
      expect(bodyStatusError({ 'dr-r-d': 'PAINT' }, 'PICKUP_SINGLE')).toMatch(/وجود ندارد/);
      expect(bodyStatusError({ 'dr-r-p': 'REPLACE' }, 'PICKUP_SINGLE')).toMatch(/وجود ندارد/);
      expect(bodyStatusError({ 'dr-f-d': 'PAINT' }, 'PICKUP_SINGLE')).toBeNull();
      expect(bodyStatusError({ 'dr-r-d': 'PAINT' }, 'PICKUP')).toBeNull();
      expect(bodyStatusError({ 'dr-r-d': 'PAINT' })).toBeNull();
    });

    it('every declared part accepts each of its own conditions', () => {
      for (const part of BODY_PARTS) {
        for (const status of part.allowed) {
          expect(bodyStatusError({ [part.key]: status })).toBeNull();
        }
      }
    });
  });

  it('currentJalaliYear is a sane 4-digit year', () => {
    const year = currentJalaliYear();
    expect(year).toBeGreaterThanOrEqual(1404);
    expect(year).toBeLessThan(1500);
  });
});
