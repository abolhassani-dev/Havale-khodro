/**
 * Factories, not fixed objects.
 *
 * Hand-built test objects scattered across twenty tests all need editing the day
 * a required field appears. A factory needs editing once.
 */
function buildUser(overrides = {}) {
  return {
    name: 'Test User',
    email: `user_${Math.random().toString(36).slice(2, 10)}@example.com`,
    password: 'Str0ngPassw0rd!',
    ...overrides,
  };
}

module.exports = { buildUser };
