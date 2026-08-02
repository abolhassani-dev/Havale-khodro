const { Router } = require('express');
const { success } = require('../responses/apiResponse');
const { prisma } = require('../config/database');

const router = Router();

/**
 * @openapi
 * /health:
 *   get:
 *     tags: [System]
 *     summary: Liveness and dependency check
 *     responses:
 *       200: { description: Healthy }
 *       503: { description: A dependency is down }
 */
router.get('/', async (_req, res) => {
  // Checking the database matters: a process that is up but cannot reach its
  // database is not healthy, and a check that always returns 200 hides exactly
  // the outage you needed it to catch.
  let database = 'up';
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    database = 'down';
  }

  const healthy = database === 'up';
  const body = {
    status: healthy ? 'ok' : 'degraded',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    checks: { database },
  };

  return healthy ? success(res, body) : res.status(503).json({ success: false, data: body });
});

module.exports = router;
