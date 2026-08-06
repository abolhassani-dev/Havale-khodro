const logger = require('../utils/logger');

/**
 * Graceful shutdown.
 *
 * On deploy the platform sends SIGTERM. Without this, in-flight requests are cut
 * mid-response — users see failures during every release.
 */
function registerShutdown(server, onClose) {
  let shuttingDown = false;

  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`${signal} received, shutting down`);

    server.close(async () => {
      try {
        if (onClose) await onClose();
      } finally {
        process.exit(0);
      }
    });

    // If connections refuse to drain, do not hang forever.
    setTimeout(() => process.exit(1), 10000).unref();
  };

  ['SIGTERM', 'SIGINT'].forEach((sig) => process.on(sig, () => shutdown(sig)));

  // A rejected promise nobody awaited is a bug, but it is not a reason to drop
  // every request in flight. Logged, and the process keeps serving.
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', { reason: String(reason) });
  });

  // An uncaught synchronous throw is different: the process is now in a state
  // no one reasoned about, and Node's default is to print to stderr and die —
  // which under Docker means the container vanishes with the reason only in a
  // log nobody is reading.
  //
  // So: write it down where it can be found, give the open connections a
  // moment to finish, then exit non-zero and let the restart policy do its
  // job. Restarting a process in an unknown state is right; carrying on in one
  // is how corrupt data gets written.
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception — restarting', { error: err.message, stack: err.stack });
    if (shuttingDown) return;
    shuttingDown = true;
    server.close(() => process.exit(1));
    setTimeout(() => process.exit(1), 5000).unref();
  });
}

module.exports = registerShutdown;
