// Machine-readable codes. Clients branch on these, not on message text —
// messages get reworded, codes do not.
const ERROR_CODES = {
  INTERNAL: 'INTERNAL_ERROR',
  BAD_REQUEST: 'BAD_REQUEST',
  VALIDATION: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',

  // Domain-specific, so the frontend can react precisely rather than guessing
  // from a 401 what actually happened.
  SESSION_KICKED: 'SESSION_KICKED',
  MUST_CHANGE_PASSWORD: 'MUST_CHANGE_PASSWORD',
  SUBSCRIPTION_EXPIRED: 'SUBSCRIPTION_EXPIRED',
  REVEAL_LIMIT_REACHED: 'REVEAL_LIMIT_REACHED',
};

module.exports = { ERROR_CODES };
