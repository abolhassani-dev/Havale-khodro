const { prisma, connectDatabase, disconnectDatabase } = require('../../src/config/database');
const smsService = require('../../src/modules/sms/sms.service');
const smsRepository = require('../../src/modules/sms/sms.repository');
const { DRIVERS } = require('../../src/modules/sms/drivers');

/**
 * The SMS panel, which does not exist yet.
 *
 * The point of these tests is that the notification path is finished and proven
 * now, with delivery switched off — so buying a panel later is a setting change
 * rather than a development task, and nobody has to find out on launch day that
 * the untested half was the half that mattered.
 *
 * Needs a database:  RUN_E2E=1 npm run test:e2e
 */
const maybe = process.env.RUN_E2E ? describe : describe.skip;

maybe('sms', () => {
  const NUMBER = '09120000001';

  beforeAll(async () => {
    await connectDatabase();
  });

  afterEach(async () => {
    await prisma.smsMessage.deleteMany({ where: { to: NUMBER } });
    await prisma.setting.deleteMany({ where: { key: smsRepository.SETTING_KEY } });
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  describe('with the panel switched off', () => {
    beforeEach(async () => {
      await smsService.setEnabled(false);
    });

    it('records what it would have sent instead of sending it', async () => {
      const result = await smsService.send({
        to: NUMBER,
        template: 'OTP',
        params: { code: '123456' },
      });

      expect(result.sent).toBe(false);
      expect(result.reason).toBe('disabled');

      const row = await prisma.smsMessage.findUnique({ where: { id: result.id } });
      expect(row.status).toBe('SKIPPED');
      // The rendered text is stored, so the demo can show the real message and
      // not a template name.
      expect(row.body).toContain('123456');
      expect(row.driver).toBe('none');
    });

    it('reports that two-factor sign-in cannot be required', async () => {
      // Demanding a code the system cannot deliver would lock every user out —
      // a worse failure than not having the second factor yet (blueprint 3.7).
      expect(await smsService.canRequireOtp()).toBe(false);
    });
  });

  describe('with the panel switched on', () => {
    it('hands the message to the driver and records the delivery', async () => {
      await smsService.setEnabled(true);

      const result = await smsService.send({
        to: NUMBER,
        template: 'SUBSCRIPTION_EXPIRING',
        params: { daysLeft: 3 },
      });

      expect(result.sent).toBe(true);

      const row = await prisma.smsMessage.findUnique({ where: { id: result.id } });
      expect(row.status).toBe('SENT');
      expect(row.driver).toBe('log');
      expect(row.sentAt).not.toBeNull();
    });

    it('never lets a failing provider break the caller', async () => {
      await smsService.setEnabled(true);

      const original = DRIVERS.log.send;
      DRIVERS.log.send = async () => {
        throw new Error('provider is down');
      };

      try {
        // A user must not be unable to sign in because an SMS gateway is down,
        // and a listing must not fail to close because a warning could not be
        // delivered. So this resolves rather than throws.
        const result = await smsService.send({
          to: NUMBER,
          template: 'OTP',
          params: { code: '999999' },
        });

        expect(result.sent).toBe(false);
        expect(result.reason).toBe('delivery_failed');

        const row = await prisma.smsMessage.findUnique({ where: { id: result.id } });
        expect(row.status).toBe('FAILED');
        expect(row.error).toContain('provider is down');
      } finally {
        DRIVERS.log.send = original;
      }
    });
  });

  it('can be switched at runtime, without a deploy', async () => {
    await smsService.setEnabled(false);
    expect(await smsService.isEnabled()).toBe(false);

    // The switch is a stored setting rather than an environment variable, so the
    // hour the panel is activated somebody can turn it on from the admin panel
    // instead of editing a file on the server at speed.
    await smsService.setEnabled(true);
    expect(await smsService.isEnabled()).toBe(true);
  });

  it('refuses to send an unknown template rather than sending an empty message', async () => {
    await smsService.setEnabled(true);

    const result = await smsService.send({ to: NUMBER, template: 'NOT_A_TEMPLATE' });

    expect(result.sent).toBe(false);
    expect(result.reason).toBe('template_error');
    // Nothing was recorded either — there was no message to record.
    expect(result.id).toBeNull();
  });

  it('will not pretend the real driver is ready when it is not configured', async () => {
    // Silently doing nothing is worse than refusing: the first is discovered
    // when a customer says they never got their code.
    expect(() => DRIVERS.kavenegar.assertConfigured()).toThrow(/SMS_API_KEY/);
  });
});
