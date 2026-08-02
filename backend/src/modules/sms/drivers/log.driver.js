const logger = require('../../../utils/logger');

/**
 * The driver used until a real SMS panel is bought.
 *
 * It "delivers" by writing to the log. Combined with the outbox table, that
 * makes the whole notification path testable and demonstrable now: the operator
 * can see exactly which message would have gone to which number, and the day the
 * panel is connected the only thing that changes is which driver is selected.
 */
const logDriver = {
  name: 'log',

  async send({ to, body }) {
    logger.info('SMS (log driver — not actually sent)', { to, body });
    return { providerId: null };
  },
};

module.exports = logDriver;
