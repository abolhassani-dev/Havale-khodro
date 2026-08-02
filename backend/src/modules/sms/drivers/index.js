const logDriver = require('./log.driver');
const kavenegarDriver = require('./kavenegar.driver');

/**
 * The drivers this system knows about.
 *
 * Adding a provider means adding one file and one line here. Nothing outside
 * this folder learns its name, which is the whole point: the day the panel is
 * bought, no calling code changes.
 */
const DRIVERS = {
  [logDriver.name]: logDriver,
  [kavenegarDriver.name]: kavenegarDriver,
};

function resolveDriver(name) {
  const driver = DRIVERS[name];
  if (!driver) {
    throw new Error(`Unknown SMS driver "${name}". Available: ${Object.keys(DRIVERS).join(', ')}`);
  }
  return driver;
}

module.exports = { DRIVERS, resolveDriver };
