const crypto = require('crypto');

/**
 * Session tokens.
 *
 * The token handed to the browser is random, not derived from user data, so it
 * carries no information and cannot be forged from a known user id.
 *
 * Only the SHA-256 hash is stored. That way a leaked database dump does not hand
 * an attacker a set of working sessions — the same reason passwords are hashed.
 * SHA-256 rather than bcrypt is right here: the token already has 256 bits of
 * entropy, so there is nothing to brute force, and this runs on every request.
 */

const TOKEN_BYTES = 32;

function generateToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString('base64url');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Six-digit SMS code. Stored hashed for the same reason as the session token. */
function generateOtp() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

module.exports = { generateToken, hashToken, generateOtp };
