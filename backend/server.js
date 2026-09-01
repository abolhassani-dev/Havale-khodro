require('dotenv').config();

const cluster = require('cluster');

const app = require('./src/app');
const config = require('./src/config');
const logger = require('./src/utils/logger');
const { connectDatabase, disconnectDatabase } = require('./src/config/database');
const registerShutdown = require('./src/hooks/shutdown');
const { startBlockList } = require('./src/middlewares/blockedIp');
const { classifyUnsetBodyTypes } = require('./src/modules/catalog/bodyClassifier');

/**
 * How many processes serve the API. One, on the machine this runs on today.
 *
 * The argument for more is the familiar one: Node runs JavaScript on a single
 * thread, so a process cannot use a second core and this server has three.
 * Measuring it said otherwise — one process was already using 179% of a core,
 * because Prisma's query engine is a Rust library with its own thread pool.
 * The cores were not idle. A second worker added no throughput at all, doubled
 * the connection pool, took Postgres from 46% of a core to a full one, and
 * pushed p95 from 367ms to 510ms by oversubscribing three cores between the
 * API, the database and nginx.
 *
 * So it stays a setting rather than a default: on a machine with cores to
 * spare it is the right lever, and everything that has to be per-process is.
 * The rate limiter divides its budget by this number (see
 * middlewares/rateLimiter), the heap ceiling is divided below, sessions live
 * in the database rather than in memory, and the one timer there is — the
 * blocked-address refresh — is per-process by design, because every worker
 * turns requests away on its own. So there is no work here that must happen
 * exactly once.
 */
const WORKERS = Math.min(Math.max(Number(process.env.WEB_CONCURRENCY) || 1, 1), 8);

/**
 * The heap ceiling belongs to the container, not to each process.
 *
 * NODE_OPTIONS carries a limit sized for the memory this container may use.
 * Left alone, every worker would claim that whole figure and two of them could
 * outgrow the container together — so the workers are started with their
 * share of it. This is what keeps WEB_CONCURRENCY a safe number to raise.
 */
function workerHeapArgs() {
  if (WORKERS < 2) return [];
  const total = Number(/--max-old-space-size=(\d+)/.exec(process.env.NODE_OPTIONS || '')?.[1]);
  if (!total) return [];
  return [`--max-old-space-size=${Math.max(96, Math.floor(total / WORKERS))}`];
}

async function start() {
  await connectDatabase();

  // The blocked-address list, held in memory and refreshed on a timer. Per
  // process on purpose: every worker turns requests away on its own, so each
  // one needs its own copy. Nothing here must happen exactly once.
  startBlockList();

  // Body shapes for catalogue models that have none yet. One worker is
  // enough — after the first run this is a single indexless count of zero
  // rows — and a failure must not stop the server: the panel falls back to
  // «سدان» until the next boot classifies whatever is still null.
  if (!cluster.isWorker || cluster.worker.id === 1) {
    classifyUnsetBodyTypes().catch((err) =>
      logger.error('body-type classification failed', { error: err.message })
    );
  }

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

  cluster.setupPrimary({ execArgv: [...process.execArgv, ...workerHeapArgs()] });

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
