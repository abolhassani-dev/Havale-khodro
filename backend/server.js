require('dotenv').config();

const cluster = require('cluster');

const app = require('./src/app');
const config = require('./src/config');
const logger = require('./src/utils/logger');
const { connectDatabase, disconnectDatabase } = require('./src/config/database');
const registerShutdown = require('./src/hooks/shutdown');

/**
 * How many processes serve the API.
 *
 * Node runs JavaScript on one thread, so one process can use one core no
 * matter how many the machine has. Under load this server sat at the edge of
 * that limit with two cores idle beside it.
 *
 * Deliberately opt-in through WEB_CONCURRENCY rather than «one per core»:
 * that default is derived from whatever machine the container happens to boot
 * on, and it would leave nothing for nginx and Postgres, which live on the
 * same three cores. The compose file sets the number this deployment wants.
 *
 * Everything that has to be right per process is: the rate limiter divides its
 * budget by this number (see middlewares/rateLimiter), sessions live in the
 * database rather than in memory, and nothing in the application runs on a
 * timer — so there is no work here that must happen exactly once.
 */
const WORKERS = Math.min(Math.max(Number(process.env.WEB_CONCURRENCY) || 1, 1), 8);

async function start() {
  await connectDatabase();

  const server = app.listen(config.port, () => {
    const who = cluster.isWorker ? ` worker ${cluster.worker.id}` : '';
    logger.info(`havale listening on port ${config.port} [${config.env}]${who}`);
    if (!cluster.isWorker) logger.info(`Docs at http://localhost:${config.port}/docs`);
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

/**
 * The parent process: it forks, it replaces what dies, and it serves nothing.
 *
 * Two failures worth naming, because both are silent:
 *
 *   Docker sends SIGTERM to this process alone. Without forwarding it, the
 *   workers keep serving until the container is killed ten seconds later —
 *   every deploy would cut requests mid-response, which is exactly what the
 *   graceful shutdown was written to avoid.
 *
 *   A worker that dies on startup — a bad migration, a missing variable —
 *   would otherwise be replaced forever, several times a second, filling the
 *   log with the same line while the container reports itself healthy because
 *   the other worker still answers. So a worker that dies in its first few
 *   seconds counts as a crash, and enough of those stop the process instead.
 */
function runPrimary() {
  logger.info(`havale starting ${WORKERS} workers [${config.env}]`);

  let shuttingDown = false;
  let quickDeaths = 0;

  const spawn = () => {
    // The workers need to know how many of them there are: anything that
    // divides a global budget between them has to divide by the right number.
    const worker = cluster.fork({ CLUSTER_WORKERS: String(WORKERS) });
    worker.startedAt = Date.now();
  };

  for (let i = 0; i < WORKERS; i += 1) spawn();

  cluster.on('exit', (worker, code, signal) => {
    if (shuttingDown) return;

    const lived = Date.now() - worker.startedAt;
    logger.error('Worker exited', { id: worker.id, code, signal, lived });

    if (lived < 5000) {
      quickDeaths += 1;
      if (quickDeaths >= WORKERS * 3) {
        logger.error('Workers keep dying at startup — stopping so this is visible');
        process.exit(1);
      }
    } else {
      quickDeaths = 0;
    }

    spawn();
  });

  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`${signal} received, stopping workers`);

    for (const worker of Object.values(cluster.workers)) worker.kill(signal);

    // Each worker drains its own requests and exits; this is only the backstop
    // for one that will not.
    setTimeout(() => process.exit(0), 15000).unref();

    cluster.on('disconnect', () => {
      if (!Object.keys(cluster.workers).length) process.exit(0);
    });
  };

  ['SIGTERM', 'SIGINT'].forEach((sig) => process.on(sig, () => shutdown(sig)));
}

if (WORKERS > 1 && cluster.isPrimary) {
  runPrimary();
} else {
  start().catch((err) => {
    logger.error('Failed to start', { error: err.message, stack: err.stack });
    process.exit(1);
  });
}
