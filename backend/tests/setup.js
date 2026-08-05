// Test environment defaults. Set before any module reads config.
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret-not-used-in-production';

// The test database is set here and not read from DATABASE_URL on purpose.
//
// The e2e suite creates and deletes rows. If it ever picked up the development
// connection string from `.env`, a single `npm test` would wipe working data —
// and the person it happens to would have no reason to suspect the test runner.
// Overriding the variable before any module loads makes that impossible: dotenv
// does not replace variables that are already set.
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgresql://havale:havale@127.0.0.1:5432/havale_test';

// Encryption is opt-in in production and on in tests, so both the middleware
// and the masking rules are exercised in their stricter configuration.
process.env.DATA_ENCRYPTION_KEY =
  process.env.DATA_ENCRYPTION_KEY ||
  '0000000000000000000000000000000000000000000000000000000000000001';

jest.setTimeout(15000);
