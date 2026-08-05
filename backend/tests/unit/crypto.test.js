const { encrypt, decrypt, isEncrypted, blindIndex } = require('../../src/utils/crypto');

/**
 * The properties that matter for encrypted contact details.
 *
 * These are cheap to run and expensive to get wrong: a mistake here is not a
 * broken feature, it is either unreadable customer data or a database leak that
 * was supposed to be useless and is not.
 */
describe('column encryption', () => {
  const PHONE = '09121234567';

  // The module reads DATA_ENCRYPTION_KEY once at load, so the mode is fixed
  // for the process. Tests run with a key set (see tests/setup.js); the
  // disabled path is covered by loading a fresh copy without one.

  it('round-trips a value', () => {
    expect(decrypt(encrypt(PHONE))).toBe(PHONE);
  });

  it('never stores the plaintext, in any encoding', () => {
    const stored = encrypt(PHONE);
    expect(stored).not.toContain(PHONE);
    // The obvious mistake would be base64 without encryption, which reads as
    // gibberish and is not.
    expect(Buffer.from(stored, 'base64').toString('utf8')).not.toContain(PHONE);
  });

  it('produces a different ciphertext every time', () => {
    // Same input twice must not look the same, or a dump reveals which agencies
    // share a coordinator without decrypting anything.
    expect(encrypt(PHONE)).not.toBe(encrypt(PHONE));
  });

  it('refuses to decrypt a tampered value rather than returning something wrong', () => {
    const stored = encrypt(PHONE);
    const parts = stored.split('.');
    const flipped = Buffer.from(parts[3], 'base64url');
    flipped[0] ^= 0xff;
    parts[3] = flipped.toString('base64url');

    // A phone number that is quietly wrong gets dialled. Null does not.
    expect(decrypt(parts.join('.'))).toBeNull();
  });

  it('passes empty values through untouched', () => {
    expect(encrypt(null)).toBeNull();
    expect(encrypt('')).toBe('');
    expect(decrypt(null)).toBeNull();
  });

  it('reads a plain value written before encryption existed', () => {
    // The migration runs against a live database; the application must not go
    // blind on rows it has not converted yet.
    expect(decrypt(PHONE)).toBe(PHONE);
    expect(isEncrypted(PHONE)).toBe(false);
    expect(isEncrypted(encrypt(PHONE))).toBe(true);
  });

  describe('with no key configured', () => {
    it('stores and indexes the value unchanged, so nothing breaks', () => {
      // Encryption is opt-in. With it off the system must behave exactly as it
      // did before the feature existed — including the unique constraint on a
      // phone number, which is what the blind index carries.
      jest.resetModules();
      const saved = process.env.DATA_ENCRYPTION_KEY;
      delete process.env.DATA_ENCRYPTION_KEY;
      const plain = require('../../src/utils/crypto');

      expect(plain.ENABLED).toBe(false);
      expect(plain.encrypt(PHONE)).toBe(PHONE);
      expect(plain.decrypt(PHONE)).toBe(PHONE);
      expect(plain.blindIndex(PHONE)).toBe(PHONE);
      expect(plain.blindIndex(PHONE)).not.toBe(plain.blindIndex('09121234568'));

      if (saved) process.env.DATA_ENCRYPTION_KEY = saved;
      jest.resetModules();
    });
  });

  describe('blind index', () => {
    it('is stable for the same input and different for another', () => {
      expect(blindIndex(PHONE)).toBe(blindIndex(PHONE));
      expect(blindIndex(PHONE)).not.toBe(blindIndex('09121234568'));
    });

    it('is not a bare hash of the number', () => {
      // Ten digits is a space an attacker enumerates in minutes. Keyed, the
      // dump alone does not let them.
      const crypto = require('crypto');
      const bare = crypto.createHash('sha256').update(PHONE).digest('hex');
      expect(blindIndex(PHONE)).not.toBe(bare);
    });

    it('does not contain the number', () => {
      expect(blindIndex(PHONE)).not.toContain(PHONE);
    });
  });
});
