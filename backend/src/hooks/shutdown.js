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

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', { reason: String(reason) });
  });
}

module.exports = registerShutdown;
