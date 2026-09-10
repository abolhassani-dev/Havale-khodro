/**
 * A telephone number as it may appear in a log line: `0912***6789`.
 *
 * Enough to tell two messages apart when reading a log, and not enough to
 * dial. Logs live outside the database's column encryption — in journald,
 * in files, in whatever ships them — so a full number there is a copy of the
 * one thing the encryption exists to protect.
 */
function maskPhone(value) {
  const s = String(value ?? '');
  if (s.length < 7) return s ? '***' : '';
  return `${s.slice(0, 4)}***${s.slice(-4)}`;
}

module.exports = { maskPhone };
