const { priceKey, brandAgrees, buildFamilies, bestMatch } = require('../../src/modules/carprice/carprice.link');

/**
 * Matching a catalogue model to a line in the price list.
 *
 * Every case below is a real pair taken out of the two live lists, including
 * the ones that must NOT match — those are the point of the exercise.
 */

const rows = (...names) => buildFamilies(names.map(([brand, name]) => ({ brand, name })));

const IKCO = 'ایران خودرو';
const SAIPA = 'سایپا';

describe('the price key', () => {
  it('folds the spellings that differ without meaning anything', () => {
    expect(priceKey('پژو ۲۰۷ اتوماتيك')).toBe(priceKey('پژو 207 اتوماتیک'));
  });

  it('keeps what is inside the brackets', () => {
    // «سورن (TU5P)» and «سورن XU7P» are different engines at different money.
    // Stripping the bracket merged them, and an EF7 car then matched.
    expect(priceKey('سورن (TU5P)')).not.toBe(priceKey('سورن XU7P'));
    expect(priceKey('سورن (TU5P)')).toContain('tu5p');
  });
});

describe('the maker guard', () => {
  it('accepts a marque the factory actually makes', () => {
    expect(brandAgrees(IKCO, 'پژو')).toBe(true);
    expect(brandAgrees(SAIPA, 'کوییک')).toBe(true);
  });

  it('refuses one it does not', () => {
    expect(brandAgrees(IKCO, 'کیا')).toBe(false);
    expect(brandAgrees(SAIPA, 'پژو')).toBe(false);
  });

  it('reads the Persian half of an imported maker’s name', () => {
    expect(brandAgrees('ولوو - Volvo', 'ولوو')).toBe(true);
    expect(brandAgrees('کیا موتورز - Kia Motors', 'کیا')).toBe(true);
  });

  it('lets the source’s miscellany drawer vouch for nobody', () => {
    // It holds cars from a dozen makers, so a match under it means nothing.
    expect(brandAgrees('سایر شرکت ها', 'پژو')).toBe(false);
  });

  it('follows the source when it files a car under the assembler', () => {
    // هایما is «ایران خودرو» on their list and a marque of its own on ours.
    // Getting this table wrong is what left nine هایما models with no price.
    expect(brandAgrees(IKCO, 'هایما')).toBe(true);
    expect(brandAgrees(SAIPA, 'چانگان')).toBe(true);
    expect(brandAgrees('گریت وال - Great Wall', 'تانک')).toBe(true);
  });
});

describe('the miscellany drawer', () => {
  const MISC = 'سایر شرکت ها';

  it('accepts a line that opens with the marque’s own name', () => {
    const fams = rows([MISC, 'لوکانو L7'], [MISC, 'فردا SX5']);
    const m = bestMatch({ name: 'لوکانو L7 1.6 لیتر توربو', brand: 'لوکانو' }, fams);
    expect(m.name).toBe('لوکانو L7');
  });

  it('refuses a line that only mentions the marque later', () => {
    // «تیگارد تیسان S05» is ours for a car the source calls «تیسان S05». The
    // opening word is the only maker evidence the drawer offers, so a line that
    // opens with another name is not this marque's.
    const fams = rows([MISC, 'تیسان S05']);
    expect(bestMatch({ name: 'تیگارد تیسان S05 1.5 لیتر توربو', brand: 'تیگارد' }, fams)).toBeNull();
  });

  it('still refuses a marque the line never names', () => {
    const fams = rows([MISC, 'لوکانو L7']);
    expect(bestMatch({ name: 'پژو L7', brand: 'پژو' }, fams)).toBeNull();
  });
});

describe('the body shape a line announces', () => {
  const pickup = rows([IKCO, 'پیکاپ فوتون (اتوماتیک)']);
  const foton = { name: 'فوتون ساوانا اتوماتیک', brand: 'فوتون' };

  it('refuses a car of the wrong shape', () => {
    // Stripping «پیکاپ» left «فوتون اتوماتیک», which an automatic ساوانا — an
    // SUV — satisfied, and a van would have been shown a pickup's price.
    expect(bestMatch({ ...foton, bodyType: 'SUV' }, pickup)).toBeNull();
  });

  it('accepts one of the right shape', () => {
    const arisan = rows([IKCO, 'وانت آریسان']);
    const m = bestMatch({ name: 'آریسان بنزینی 1.7 لیتر', brand: 'آریسان', bodyType: 'PICKUP_SINGLE' }, arisan);
    expect(m.name).toBe('وانت آریسان');
  });

  it('does not treat an unclassified car as the wrong shape', () => {
    // Two thirds of the catalogue has no body type set; refusing all of them
    // would cost far more true links than the one false link this guard stops.
    expect(bestMatch({ ...foton, bodyType: null }, pickup)).not.toBeNull();
  });
});

describe('choosing the line that covers a car', () => {
  const peugeot = rows(
    [IKCO, 'پژو 207 اتوماتیک'],
    [IKCO, 'پژو 207 اتوماتیک پانوراما'],
    [IKCO, 'پژو 207 دنده‌ای (هیدرولیک)'],
    [IKCO, 'پژو 207 موتور TU3']
  );

  it('links a trim the source does not separate', () => {
    // The source prices «207 اتوماتیک» once; our catalogue splits the engine.
    // Both of ours point at the one line, which is what the source means.
    for (const name of ['پژو 207 اتوماتیک TU5', 'پژو 207 اتوماتیک TU5P']) {
      expect(bestMatch({ name, brand: 'پژو' }, peugeot).name).toBe('پژو 207 اتوماتیک');
    }
  });

  it('prefers the line that says more', () => {
    const m = bestMatch({ name: 'پژو 207 پانوراما اتوماتیک TU5', brand: 'پژو' }, peugeot);
    expect(m.name).toBe('پژو 207 اتوماتیک پانوراما');
  });

  it('refuses a car the line does not describe', () => {
    // «موتور TU3» is on the line, so only a TU3 car may claim it.
    expect(bestMatch({ name: 'پژو 207 صندوقدار دنده‌ ای', brand: 'پژو' }, peugeot)).toBeNull();
  });

  it('will not put one engine’s price on another', () => {
    const soren = rows([IKCO, 'سورن (TU5P)'], [IKCO, 'سورن XU7P']);
    expect(bestMatch({ name: 'سمند سورن پلاس TU5P', brand: 'سمند' }, soren).name).toBe('سورن (TU5P)');
    // Nothing on the list is an EF7, so this car gets no price rather than
    // the nearest one — the bug that made the brackets matter.
    expect(bestMatch({ name: 'سمند سورن پلاس EF7 بنزینی', brand: 'سمند' }, soren)).toBeNull();
  });

  it('says nothing when two lines fit equally well', () => {
    const tie = rows([SAIPA, 'شاهین اتوماتیک G'], [SAIPA, 'شاهین اتوماتیک پلاس']);
    expect(bestMatch({ name: 'شاهین پلاس اتوماتیک AT تیپ G', brand: 'شاهین' }, tie)).toBeNull();
  });

  it('says nothing for a car the source does not price at all', () => {
    // A new-car list has no پراید and no ۲۰۶, and never will.
    expect(bestMatch({ name: 'پژو 206 SD V1', brand: 'پژو' }, peugeot)).toBeNull();
    expect(bestMatch({ name: 'پراید 131 SE', brand: 'پراید' }, peugeot)).toBeNull();
  });

  it('does not read a decimal as two separate numbers', () => {
    // «ام جی 5» fitted «آرتابان (ای ام جی) آرتان 1.5 لیتر» because the engine
    // size split into «1» and «5», inventing the 5. An MG's price was put on
    // an Artan.
    const mg = rows(['ام جی - MG', 'ام جی 5']);
    const artan = { name: 'آرتابان (ای ام جی) آرتان 1.5 لیتر', brand: 'آرتابان (ای ام جی)' };
    expect(bestMatch(artan, mg)).toBeNull();
  });

  it('will not take a maker’s name out of the middle of another', () => {
    // Same advertisement, other half of the cause: the catalogue brand
    // «آرتابان (ای ام جی)» contains the words «ام جی» and passed as MG.
    expect(brandAgrees('ام جی - MG', 'آرتابان (ای ام جی)')).toBe(false);
    expect(brandAgrees('ام جی - MG', 'ام جی')).toBe(true);
  });

  it('reads a trim word written in Latin on one list and Persian on the other', () => {
    const venucia = rows(['ونوسیا - Venucia', 'ونوسیا STAR'], ['ونوسیا - Venucia', 'ونوسیا D60 Plus']);
    expect(bestMatch({ name: 'ونوسیا استار 1.5 لیتر توربو', brand: 'ونوسیا' }, venucia).name).toBe('ونوسیا STAR');
    expect(bestMatch({ name: 'ونوسیا D60 پلاس 1.6 لیتر', brand: 'ونوسیا' }, venucia).name).toBe('ونوسیا D60 Plus');
  });

  it('reads a car the source files under its assembler', () => {
    // «هایما اس 5 ( S5 ) پرو» writes the letter twice, spelled and abbreviated.
    const haima = rows([IKCO, 'هایما اس 5 ( S5 ) پرو'], [IKCO, 'هایما 8 اس ( 8S )']);
    expect(bestMatch({ name: 'هایما S5 پرو 1.5 لیتر توربو', brand: 'هایما' }, haima).name).toBe(
      'هایما اس 5 ( S5 ) پرو'
    );
    expect(bestMatch({ name: 'هایما 8S', brand: 'هایما' }, haima).name).toBe('هایما 8 اس ( 8S )');
  });

  it('does not cross makers on a shared word', () => {
    const nissan = rows(['نیسان - Nissan', 'ترا اکسکلوسیو']);
    expect(bestMatch({ name: 'نیسان ترا اکسکلوسیو', brand: 'نیسان' }, nissan)).not.toBeNull();
    expect(bestMatch({ name: 'کیا ترا اکسکلوسیو', brand: 'کیا' }, nissan)).toBeNull();
  });
});

describe('gathering the distinct cars in a snapshot', () => {
  it('folds rows that name the same car into one', () => {
    const fams = rows([IKCO, 'دنا پلاس اتوماتیک'], [IKCO, 'دنا پلاس اتوماتیک'], [IKCO, 'دنا پلاس MT6']);
    expect(fams).toHaveLength(2);
  });
});
