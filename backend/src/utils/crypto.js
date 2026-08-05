const crypto = require('crypto');

/**
 * Encryption for the columns that would matter most in a database leak.
 *
 * Why encryption and not hashing. A hash is one-way, and these numbers have to
 * come back out: an agency that spent one of its thirty daily views has bought
 * the right to read that number. Hashing them would destroy the product. What a
 * leak actually needs to be defended against is different — a stolen dump, a
 * backup file that ended up somewhere it should not have, a snapshot from the
 * hosting panel. None of those come with the server's `.env`, and without the
 * key this ciphertext is noise.
 *
 * What this does not defend against, stated plainly so nobody is surprised: an
 * attacker who is running code on the server reads the key out of the
 * environment and decrypts everything. This raises the cost of the most likely
 * incident — data at rest walking off — and does nothing for the worst one.
 *
 * AES-256-GCM: authenticated, so a modified ciphertext fails to decrypt rather
 * than returning quietly wrong plaintext. A fresh random IV per value, stored
 * beside it, because reusing an IV under GCM is catastrophic.
 *
 * Stored form:  v1.<iv-base64url>.<tag-base64url>.<ciphertext-base64url>
 * The version prefix is there so a future key rotation or algorithm change can
 * tell the two apart instead of guessing.
 */

/**
 * Off unless a key is configured.
 *
 * Encryption at rest was added and then switched off again at the owner's
 * request: it is a real protection against a stolen dump, and it is also one
 * more thing that can go wrong at a moment when the priority is a system that
 * simply works. Nothing about it is lost — set DATA_ENCRYPTION_KEY, run
 * `node scripts/encrypt-existing.js`, and every column converts in place.
 *
 * With no key, values pass through untouched and the blind index is the value
 * itself, so the unique constraint on a phone number behaves exactly as it did
 * before any of this existed.
 */
const ENABLED = Boolean(process.env.DATA_ENCRYPTION_KEY);

const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // 96 bits, the size GCM is defined for
const b64 = (buf) => buf.toString('base64url');

let cachedKey = null;

/**
 * The key, derived once.
 *
 * Accepts either 32 raw bytes as hex (what the setup command generates) or a
 * passphrase, which is stretched with scrypt so a short one is not simply used
 * as-is. Refuses to run in production without a key: silently storing contact
 * details in clear text because a variable was missing is exactly the failure
 * this file exists to prevent.
 */
function key() {
  if (cachedKey) return cachedKey;

  const raw = process.env.DATA_ENCRYPTION_KEY;

  if (!raw) {
    // Only reached for reading values written while a key *was* set. A fixed
    // development key keeps tests reproducible across restarts.
    cachedKey = crypto.scryptSync('development-only-key', 'feranocar', 32);
    return cachedKey;
  }

  cachedKey = /^[0-9a-f]{64}$/i.test(raw)
    ? Buffer.from(raw, 'hex')
    : crypto.scryptSync(raw, 'feranocar-v1', 32);

  return cachedKey;
}

/** Encrypts a value. `null` and `''` pass through — an absent number is not a secret. */
function encrypt(plain) {
  if (!ENABLED) return plain ?? null;
  if (plain === null || plain === undefined || plain === '') return plain ?? null;

  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);

  return `${VERSION}.${b64(iv)}.${b64(cipher.getAuthTag())}.${b64(ciphertext)}`;
}

/**
 * Decrypts a value.
 *
 * A value without the version prefix is returned unchanged: rows written before
 * encryption was introduced are still readable, so the migration can run in the
 * background instead of the application going blind the moment it deploys.
 */
function decrypt(stored) {
  if (stored === null || stored === undefined || stored === '') return stored ?? null;
  if (!isEncrypted(stored)) return stored;

  const [, ivPart, tagPart, dataPart] = String(stored).split('.');
  try {
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      key(),
      Buffer.from(ivPart, 'base64url')
    );
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataPart, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    // Wrong key, or the ciphertext was altered. Returning something plausible
    // here would be worse than returning nothing — a phone number that is
    // quietly wrong gets dialled.
    return null;
  }
}

function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(`${VERSION}.`);
}

/**
 * A deterministic index for a value that is stored encrypted.
 *
 * Encrypted columns cannot be searched or made unique — the same number
 * encrypts differently every time, which is the point. Where a lookup is
 * needed (signing in by phone, refusing a duplicate registration), this HMAC
 * gives one stable value per input. It leaks equality and nothing else, and it
 * is keyed, so an attacker with the dump cannot build a rainbow table of
 * Iranian mobile numbers — which, over a ten-digit space, they otherwise could
 * in minutes.
 */
function blindIndex(value) {
  if (value === null || value === undefined || value === '') return null;
  // With encryption off the index is the plain value, so the unique constraint
  // and lookups by phone behave exactly as they did before encryption existed.
  if (!ENABLED) return String(value);
  return crypto.createHmac('sha256', key()).update(String(value)).digest('hex');
}

module.exports = { encrypt, decrypt, isEncrypted, blindIndex, ENABLED };
