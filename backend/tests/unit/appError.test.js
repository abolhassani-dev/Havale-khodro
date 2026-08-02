const { NotFoundError, ConflictError } = require('../../src/errors/AppError');
const { ERROR_CODES } = require('../../src/constants/errorCodes');

describe('AppError', () => {
  it('carries a status, a code, and a client-safe message', () => {
    const err = new NotFoundError('User');
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe(ERROR_CODES.NOT_FOUND);
    expect(err.message).toBe('User not found');
  });

  it('marks deliberate errors as operational so the handler can safely surface them', () => {
    expect(new ConflictError().isOperational).toBe(true);
  });
});
