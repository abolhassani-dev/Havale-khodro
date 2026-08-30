const { normalise, inspect, maskContact } = require('../../src/utils/textGuard');

/**
 * The rule that keeps a phone number out of a description box.
 *
 * Half of these tests are about what must *not* be caught. A filter that
 * refuses an honest listing is worse than one that misses a dishonest one:
 * the leak costs one contact, the false refusal teaches an agency that the
 * form is broken and they stop writing descriptions at all.
 */
describe('textGuard', () => {
  const hardOf = (text, ctx) => inspect(text, ctx).hard;

  describe('normalising', () => {
    it('folds Persian and Arabic numerals to ASCII', () => {
      expect(normalise('۰۹۱۲۳۴۵۶۷۸۹')).toBe('09123456789');
      expect(normalise('٠٩١٢')).toBe('0912');
    });

    it('drops the invisible characters used to break a pattern', () => {
      expect(normalise('۰۹۱۲‌۳۴۵​۶۷۸۹')).toBe('09123456789');
    });

    it('closes up the punctuation people put between digits', () => {
      expect(normalise('0912*345*6789')).toBe('09123456789');
      expect(normalise('0912 345 67 89')).toBe('09123456789');
    });

    it('leaves punctuation that is not between two digits alone', () => {
      expect(normalise('مدل ۱۴۰۵ - رنگ سفید')).toBe('مدل 1405 - رنگ سفید');
    });

    it('turns spelled-out digits back into numerals', () => {
      expect(normalise('صفر نهصد')).toBe('0900');
    });
  });

  describe('what is refused', () => {
    it('an Iranian mobile number, however it is written', () => {
      for (const text of [
        'تماس: ۰۹۱۲۳۴۵۶۷۸۹',
        'شماره من 09123456789 است',
        '۰۹۱۲*۳۴۵*۶۷۸۹',
        '0912 345 67 89',
        '+989123456789',
        '۰۹۱۲‌۳۴۵‌۶۷۸۹',
      ]) {
        expect(hardOf(text)).toContain('PHONE');
      }
    });

    /**
     * The first version of this rule looked for «۰۹ and nine more digits», and
     * the owner beat it the same afternoon by writing «۰۰۹۸۹۳۳۵۵۲۱۴» — a number
     * a reader will happily dial, and not that shape. Every fixed length has a
     * neighbour like that, which is why the rule now asks what a *price* looks
     * like instead of what a phone looks like.
     */
    it('a number that is not the exact shape of a mobile', () => {
      for (const text of [
        '۰۰۹۸۹۳۳۵۵۲۱۴',
        '۰۲۱۸۸۷۷۶۶۵۵',
        '۰۹۱۲۳۴۵۶۷۸',
        '۹۱۲۳۴۵۶۷۸۹',
      ]) {
        expect(hardOf(text)).toContain('PHONE');
      }
    });

    it('a messenger handle', () => {
      expect(hardOf('آیدی: @alborz_car')).toContain('HANDLE');
    });

    it('a link or a bare domain', () => {
      expect(hardOf('سایت ما: alborzcar.ir')).toContain('LINK');
      expect(hardOf('https://example.com/x')).toContain('LINK');
    });

    /**
     * Their own name, which is the leak the code rule did not cover: «طرح:
     * نمایندگی پارس» tells the market who is advertising without a digit in
     * sight, and the reveal it replaces is the one people pay for.
     */
    it('the agency’s own name, matched whole', () => {
      const id = { agencyCode: 'G-1002', agencyName: 'نمایندگی پارس' };
      expect(hardOf('طرح نمایندگی پارس', id)).toContain('AGENCY_NAME');

      // And the reason it is matched whole rather than word by word: an agency
      // called «نمایندگی پارس» must still be able to advertise a پژو پارس.
      expect(hardOf('پژو پارس مدل ۱۴۰۵', id)).toHaveLength(0);
    });

    it('a short agency name is left alone, because it is also a word', () => {
      // Four letters is not a name, it is vocabulary. Blocking it would refuse
      // honest text for ever after.
      expect(hardOf('سمند مدل ۱۴۰۵', { agencyName: 'سمند' })).toHaveLength(0);
    });

    it('the word «نمایندگی» in a scheme name, where it can only mean one thing', () => {
      const strict = { strictIdentity: true };
      expect(hardOf('فروش ویژه نمایندگی مجاز', strict)).toContain('AGENCY_WORD');

      // In a description it is an ordinary sentence, and stays one.
      expect(hardOf('با نمایندگی هماهنگ کنید')).toHaveLength(0);
    });

    it('the agency’s own code, which is the one identifier we know exactly', () => {
      expect(hardOf('نمایندگی G-1001', { agencyCode: 'G-1001' })).toContain('AGENCY_CODE');
      // Somebody else's code is not this rule's business — the panel shows codes
      // to anybody who paid, and quoting one is not revealing your own identity.
      expect(hardOf('نمایندگی G-2002', { agencyCode: 'G-1001' })).toHaveLength(0);
    });
  });

  describe('what must never be refused', () => {
    /**
     * The cases that decide whether this feature helps or hurts. Every one of
     * these is a sentence a real agency would write.
     */
    const innocent = [
      'قیمت ۹۵۰۰۰۰۰۰۰ تومان و تحویل ۴۵ روزه',
      'مدل ۱۴۰۵، رنگ سفید، صلح',
      'طرح پیش‌فروش ۱۴۰۵ ایران خودرو',
      'مبلغ واریزی تا امروز ۳۰۰,۰۰۰,۰۰۰ تومان',
      'تعداد ۱۲ ظرفیت، اولویت زمانی',
      'تلگرام ندارم، فقط تماس تلفنی',
      'کد رهگیری ثبت‌نام ندارد',
      'تحویل ۳ ماهه، بدون قرعه‌کشی',
    ];

    it.each(innocent)('«%s»', (text) => {
      expect(hardOf(text, { agencyCode: 'G-1001' })).toHaveLength(0);
    });

    /**
     * The discriminator, stated as a test: a price is round and a telephone
     * number is not. If this ever goes red the rule has stopped being usable,
     * whatever it is catching.
     */
    it.each([
      'قیمت ۱۲۰۰۰۰۰۰۰۰ تومان',
      'قیمت ۱٬۲۵۰٬۰۰۰٬۰۰۰ تومان',
      'مجموعاً ۹۵۰۰۰۰۰۰۰ تومان',
      'تا ۱۲۰۰۰۰۰۰۰۰۰ تومان',
    ])('a round price is not a phone number: «%s»', (text) => {
      expect(hardOf(text)).toHaveLength(0);
    });

    it('a long price still raises the soft flag, so a human can look', () => {
      const { hard, soft } = inspect('قیمت ۱۲۰۰۰۰۰۰۰۰ تومان');
      expect(hard).toHaveLength(0);
      expect(soft).toContain('DIGITS');
    });

    it('the word «تلگرام» only raises a flag', () => {
      const { hard, soft } = inspect('تلگرام ندارم');
      expect(hard).toHaveLength(0);
      expect(soft).toContain('MESSENGER');
    });
  });

  describe('masking on the way out', () => {
    it('leaves the words around a blanked number readable', () => {
      // The loose mask regex used to eat the space after the number and glue
      // the two words together.
      expect(maskContact('تماس ۰۰۹۸۹۳۳۵۵۲۱۴ فوری')).toBe('تماس ▪▪▪ فوری');
    });

    it('blanks a number that is already stored', () => {
      const masked = maskContact('تماس: ۰۹۱۲۳۴۵۶۷۸۹ فوری');
      expect(masked).not.toMatch(/۰۹۱۲|09123/);
      expect(masked).toContain('▪▪▪');
      // The rest of the sentence survives — the point is to remove the number,
      // not to delete what somebody wrote.
      expect(masked).toContain('فوری');
    });

    it('blanks a handle and a link', () => {
      expect(maskContact('@alborz_car')).toBe('▪▪▪');
      expect(maskContact('سایت: alborzcar.ir')).toContain('▪▪▪');
    });

    it('leaves an honest description exactly as it was', () => {
      const text = 'قیمت ۹۵۰۰۰۰۰۰۰ تومان، تحویل ۴۵ روزه، مدل ۱۴۰۵';
      expect(maskContact(text)).toBe(text);
    });

    it('is safe on nothing', () => {
      expect(maskContact('')).toBe('');
      expect(maskContact(null)).toBeNull();
    });
  });
});
