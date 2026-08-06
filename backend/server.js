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

  // Node's defaults let a request occupy a socket for five minutes. On a small
  // server that is how a handful of stuck requests — a slow query, a client
  // that stopped reading — quietly consume every connection until healthy
  // traffic cannot get in, and the symptom is "the site is slow" with nothing
  // in the logs. A request here either finishes in thirty seconds or is not
  // going to; failing it releases the socket.
  server.requestTimeout = 30000;
  // Slightly longer than requestTimeout so a timed-out request gets a response
  // rather than having its connection torn out from under it.
  server.headersTimeout = 35000;
  // Must exceed nginx's keepalive_timeout (75s default), or nginx will reuse a
  // connection Node has already decided to close and the user sees a 502.
  server.keepAliveTimeout = 90000;

  registerShutdown(server, disconnectDatabase);
}

start().catch((err) => {
  logger.error('Failed to start', { error: err.message, stack: err.stack });
  process.exit(1);
});
