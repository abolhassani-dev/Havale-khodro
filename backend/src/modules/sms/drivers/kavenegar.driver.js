const config = require('../../../config');

/**
 * Kavenegar, one of the common Iranian providers.
 *
 * Written now and left inert until `SMS_API_KEY` and `SMS_SENDER` are set, so
 * that connecting a panel is a configuration change rather than a development
 * task. Any other provider is a sibling of this file: the contract a driver has
 * to meet is `send({ to, body }) -> { providerId }`, and nothing outside this
 * folder knows which one is in use.
 */

const TIMEOUT_MS = 10_000;

const kavenegarDriver = {
  name: 'kavenegar',

  /** Refuses to pretend it is ready. A driver that silently no-ops is worse
   *  than one that says it is not configured. */
  assertConfigured() {
    if (!config.sms.apiKey || !config.sms.sender) {
      throw new Error('SMS_API_KEY and SMS_SENDER are required for the kavenegar driver');
    }
  },

  async send({ to, body }) {
    this.assertConfigured();

    const url = `https://api.kavenegar.com/v1/${config.sms.apiKey}/sms/send.json`;
    const params = new URLSearchParams({ receptor: to, sender: config.sms.sender, message: body });

    // A hung provider must not hold a request open indefinitely — notifications
    // are never worth blocking the action that triggered them.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
        signal: controller.signal,
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok || !payload || payload.return?.status !== 200) {
        const reason = payload?.return?.message || `HTTP ${response.status}`;
        throw new Error(`Kavenegar rejected the message: ${reason}`);
      }

      return { providerId: String(payload.entries?.[0]?.messageid ?? '') || null };
    } finally {
      clearTimeout(timer);
    }
  },
};

module.exports = kavenegarDriver;
