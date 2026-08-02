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

  listRecent({ take = 50 } = {}) {
    return prisma.smsMessage.findMany({ orderBy: { createdAt: 'desc' }, take });
  },
};

module.exports = smsRepository;
