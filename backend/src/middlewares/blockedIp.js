const securityService = require('../modules/security/security.service');
const logger = require('../utils/logger');

/**
 * The door, for addresses somebody decided to close it on.
 *
 * ── Why the list is cached ──────────────────────────────────────────────────
 *
 * This runs before every request. Reading the table each time would put a query
 * in front of every page view to enforce a list that is almost always empty and
 * changes about once a month — and it would do it most expensively exactly when
 * an attack is generating the most requests. So the set is held in memory and
 * refreshed on a timer, and a block therefore takes effect within a minute
 * rather than instantly. That is the right trade for something a person decides
 * in advance, not something the system decides mid-attack.
 *
 * ── Why blocking is never automatic ─────────────────────────────────────────
 *
 * The address comes from `X-Forwarded-For`, which the client controls. An
 * attacker who can put an arbitrary value there can, in a system that blocks by
 * itself, get real agencies locked out of their own accounts — the defence
 * becomes the attack. So the rules in threatDetect only ever record, and the
 * only thing that writes to this list is a person clicking a button.
 */

const REFRESH_MS = 60 * 1000;

let blocked = new Set();
let timer = null;

async function refresh() {
  try {
    blocked = await securityService.activeBlocks();
  } catch (err) {
    // Keep the previous set. An unreachable database must not silently open
    // the door — nor close it on everybody.
    logger.error('Could not refresh the blocked address list', { error: err.message });
  }
}

/** Called once at startup. Safe to call again; the timer is not duplicated. */
function startBlockList() {
  if (timer) return;
  refresh();
  timer = setInterval(refresh, REFRESH_MS);
  // Never the reason the process stays alive at shutdown.
  if (timer.unref) timer.unref();
}

function stopBlockList() {
  if (timer) clearInterval(timer);
  timer = null;
}

function blockedIp(req, res, next) {
  if (!blocked.size || !blocked.has(req.ip)) return next();

  // 403 and nothing else. No explanation of why, no mention of a list: telling
  // an attacker which of their addresses is known is telling them which one to
  // stop using.
  return res.status(403).json({
    success: false,
    error: { code: 'FORBIDDEN', message: 'دسترسی شما به این سامانه مجاز نیست.' },
  });
}

module.exports = blockedIp;
module.exports.startBlockList = startBlockList;
module.exports.stopBlockList = stopBlockList;
module.exports.refreshBlockList = refresh;
