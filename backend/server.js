require('dotenv').config();

const app = require('./src/app');
const config = require('./src/config');
const logger = require('./src/utils/logger');
const { connectDatabase, disconnectDatabase } = require('./src/config/database');
const registerShutdown = require('./src/hooks/shutdown');

async function start() {
  await connectDatabase();

  const server = app.listen(config.port, () => {
    logger.info(`havale listening on port ${config.port} [${config.env}]`);
    logger.info(`Docs at http://localhost:${config.port}/docs`);
  });

  registerShutdown(server, disconnectDatabase);
}

start().catch((err) => {
  logger.error('Failed to start', { error: err.message, stack: err.stack });
  process.exit(1);
});
