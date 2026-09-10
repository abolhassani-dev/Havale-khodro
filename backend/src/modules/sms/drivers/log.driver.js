const logger = require('../../../utils/logger');

/**
 * The driver used until a real SMS panel is bought.
 *
 * It "delivers" by writing to the log. Combined with the outbox table, that
 * makes the whole notification path testable and demonstrable now: the operator
 * can see exactly which message would have gone to which number, and the day the
 * panel is connected the only thing that changes is which driver is selected.
 */
const { maskPhone } = require('../../../utils/maskPhone');

const logDriver = {
  name: 'log',

  async send({ to, body }) {
    // The number is masked and the text is measured, not printed: the log is
    // outside the database's encryption, and a recipient list in plain text
    // there would undo what the column encryption is for. The full row is in
    // the SmsMessage table for anybody who needs to read it.
    logger.info('SMS (log driver — not actually sent)', { to: maskPhone(to), chars: body.length });
    return { providerId: null };
  },
};

module.exports = logDriver;
