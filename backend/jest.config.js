module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  collectCoverageFrom: ['src/**/*.js', '!src/docs/**'],
  coverageThreshold: {
    // Deliberately modest. A high number that skips the authorization checks is
    // worse than an honest one that includes them.
    global: { branches: 50, functions: 50, lines: 60, statements: 60 },
  },
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
};
