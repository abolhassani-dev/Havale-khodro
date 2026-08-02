const { prisma } = require('../../config/database');

const SETTING_KEY = 'sms.enabled';

const smsRepository = {
  SETTING_KEY,

  record(data) {
    return prisma.smsMessage.create({ data });
  },

  markSent(id, providerId) {
    return prisma.smsMessage.update({
      where: { id },
      data: { status: 'SENT', providerId, sentAt: new Date() },
    });
  },

  markFailed(id, error) {
    return prisma.smsMessage.update({
      where: { id },
      // Truncated: a provider that returns a stack trace should not be able to
      // fill a column with it.
      data: { status: 'FAILED', error: String(error).slice(0, 500) },
    });
  },

  /**
   * The runtime on/off switch, stored rather than compiled in so it can be
   * flipped from the admin panel the hour the panel is activated — without a
   * deploy, and without anyone editing a file on the server at speed.
   */
  async isEnabled(fallback) {
    const row = await prisma.setting.findUnique({ where: { key: SETTING_KEY } });
    if (!row) return fallback;
    return row.value === 'true';
  },

  setEnabled(enabled) {
    return prisma.setting.upsert({
      where: { key: SETTING_KEY },
      update: { value: String(enabled) },
      create: { key: SETTING_KEY, value: String(enabled) },
    });
  },

  listRecent({ take = 50 } = {}) {
    return prisma.smsMessage.findMany({ orderBy: { createdAt: 'desc' }, take });
  },
};

module.exports = smsRepository;
