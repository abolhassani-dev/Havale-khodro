const { prisma } = require('../../config/database');
const config = require('../../config');

/**
 * Values the operator can change without a deploy.
 *
 * Anything a business decision might revise belongs here rather than in the
 * code: the seat price, the reporting cap, whether the SMS panel is live. The
 * rule of thumb is whether changing it is a business decision or an engineering
 * one — the first goes in this table, the second stays in the source.
 *
 * Every key is declared with a type and a default, so a missing row behaves
 * predictably and a typo in a key name fails loudly instead of silently reading
 * as `undefined`.
 */

const SETTINGS = {
  'sms.enabled': {
    type: 'boolean',
    default: () => config.sms.enabled,
    description: 'ارسال واقعی پیامک فعال است',
  },
  'auth.requireOtp': {
    type: 'boolean',
    // Off until an SMS panel exists: demanding a code the system cannot deliver
    // locks everyone out (blueprint 3.8).
    default: () => false,
    description: 'الزام کد دو عاملی هنگام ورود',
  },
  'seat.priceToman': {
    type: 'bigint',
    // Blueprint 4.7. Read from settings rather than code, by clause 4.10.
    default: () => 1_000_000n,
    description: 'قیمت هر ظرفیت زیرنماینده در هر دوره (تومان)',
  },
  'report.dailyLimit': {
    type: 'number',
    default: () => 5,
    description: 'سقف گزارش تخلف هر نماینده در ۲۴ ساعت',
  },
};

function parse(definition, raw) {
  if (definition.type === 'boolean') return raw === 'true';
  if (definition.type === 'number') return Number(raw);
  if (definition.type === 'bigint') return BigInt(raw);
  return raw;
}

function serialise(definition, value) {
  if (definition.type === 'boolean') return String(Boolean(value));
  return String(value);
}

function definitionFor(key) {
  const definition = SETTINGS[key];
  // A typo in a key name is a bug, and it should stop here rather than travel on
  // as a silent `undefined` that reads as "off".
  if (!definition) throw new Error(`Unknown setting: ${key}`);
  return definition;
}

const settingsService = {
  SETTINGS,

  async get(key) {
    const definition = definitionFor(key);
    const row = await prisma.setting.findUnique({ where: { key } });
    return row ? parse(definition, row.value) : definition.default();
  },

  async set(key, value) {
    const definition = definitionFor(key);
    const stored = serialise(definition, value);
    await prisma.setting.upsert({
      where: { key },
      update: { value: stored },
      create: { key, value: stored },
    });
    return parse(definition, stored);
  },

  /** Everything, with the defaults filled in, for the settings screen. */
  async all() {
    const rows = await prisma.setting.findMany();
    const stored = new Map(rows.map((r) => [r.key, r.value]));

    return Object.entries(SETTINGS).map(([key, definition]) => ({
      key,
      description: definition.description,
      type: definition.type,
      value: stored.has(key) ? parse(definition, stored.get(key)) : definition.default(),
      isDefault: !stored.has(key),
    }));
  },
};

module.exports = settingsService;
