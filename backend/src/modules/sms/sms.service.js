const config = require('../../config');
const logger = require('../../utils/logger');
const smsRepository = require('./sms.repository');
const { render } = require('./sms.templates');
const { resolveDriver } = require('./drivers');

/**
 * Sending an SMS, whether or not there is a panel to send it with.
 *
 * There is no panel yet, and there may not be one by the first demo. So the
 * whole path is built and exercised now with the switch off: every message is
 * rendered and written to the outbox, and only the last step — handing it to a
 * provider — is skipped. The demo shows exactly what would have been sent to
 * whom, and activating the panel later is a setting and two environment
 * variables, not a development task.
 */

/**
 * Failing to send a notification never fails the thing that triggered it.
 *
 * A user must not be unable to sign in because a provider is down, and a listing
 * must not fail to close because a warning could not be delivered. Every caller
 * gets a result object; nothing here throws for a delivery problem.
 */
const smsService = {
  async isEnabled() {
    return smsRepository.isEnabled(config.sms.enabled);
  },

  /**
   * @param {object}  args
   * @param {string}  args.to        the recipient's mobile number
   * @param {string}  args.template  a key from sms.templates
   * @param {object}  [args.params]  values the template needs
   * @param {string}  [args.userId]  who it concerns, for the admin view
   * @returns {Promise<{sent: boolean, reason?: string, id: string|null}>}
   */
  async send({ to, template, params = {}, userId = null }) {
    let body;
    try {
      body = render(template, params);
    } catch (err) {
      // An unknown template is a programming mistake, not a delivery problem,
      // and it should be loud.
      logger.error('SMS template failed to render', { template, error: err.message });
      return { sent: false, reason: 'template_error', id: null };
    }

    const enabled = await this.isEnabled();
    const driver = enabled ? resolveDriver(config.sms.driver) : null;

    const message = await smsRepository.record({
      to,
      template,
      body,
      userId,
      driver: driver ? driver.name : 'none',
      status: enabled ? 'PENDING' : 'SKIPPED',
    });

    if (!enabled) {
      // Recorded, not sent. The row is the point: when the panel is switched on
      // there is already a history of what the system wanted to say.
      logger.info('SMS skipped — panel is off', { to, template, id: message.id });
      return { sent: false, reason: 'disabled', id: message.id };
    }

    try {
      const { providerId } = await driver.send({ to, body });
      await smsRepository.markSent(message.id, providerId);
      return { sent: true, id: message.id };
    } catch (err) {
      await smsRepository.markFailed(message.id, err.message);
      logger.error('SMS delivery failed', { to, template, error: err.message });
      return { sent: false, reason: 'delivery_failed', id: message.id };
    }
  },

  /** Turns the panel on or off at runtime, from the admin panel. */
  async setEnabled(enabled) {
    await smsRepository.setEnabled(enabled);
    logger.info('SMS panel switched', { enabled });
    return { enabled };
  },

  /**
   * Whether two-factor sign-in can be required.
   *
   * Tied to the same switch: demanding a code the system cannot deliver would
   * lock every user out, which is a worse failure than not having the second
   * factor yet (blueprint 3.7).
   */
  async canRequireOtp() {
    return this.isEnabled();
  },
};

module.exports = smsService;
