const { prisma } = require('../../config/database');
const { isHidden } = require('../../constants/roles');
const requestContext = require('../../utils/requestContext');

/**
 * Database access for authentication: users by username, sessions, and the
 * failed-login trail used for lockout.
 *
 * No rules live here. Whether a lockout applies is the service's decision; this
 * layer only counts.
 */

/**
 * Is this account one of the ones that leaves no trace?
 *
 * Cached per process. Cleared whenever a role is written — see
 * `forgetHiddenActor` — so promoting or demoting somebody takes effect at once
 * rather than on the next deploy.
 */
const hiddenActorCache = new Map();

/**
 * Actions that are written even for an account that leaves no trace.
 *
 * These are not audit entries, they are the security counter — the lockout
 * reads them. Hiding them would hide the account from the protection meant to
 * defend it.
 */
const SECURITY_ACTIONS = new Set(['LOGIN_FAILED']);

async function isHiddenActor(userId) {
  if (hiddenActorCache.has(userId)) return hiddenActorCache.get(userId);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  const hidden = Boolean(user && isHidden(user.role));
  hiddenActorCache.set(userId, hidden);
  return hidden;
}

function forgetHiddenActor(userId) {
  if (userId) hiddenActorCache.delete(userId);
  else hiddenActorCache.clear();
}
const authRepository = {
  findByUsername(username) {
    return prisma.user.findUnique({ where: { username } });
  },

  findUserById(id) {
    return prisma.user.findUnique({ where: { id } });
  },

  createSession({ userId, tokenHash, ip, userAgent, expiresAt }) {
    return prisma.authSession.create({
      data: { userId, tokenHash, ip, userAgent, expiresAt },
    });
  },

  findLiveSession(tokenHash) {
    return prisma.authSession.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
  },

  /**
   * Ends every other live session for this user in one statement.
   *
   * Doing it as a single UPDATE rather than a read-then-write loop means two
   * simultaneous logins cannot both survive by interleaving.
   */
  revokeOtherSessions(userId, keepSessionId, reason) {
    return prisma.authSession.updateMany({
      where: {
        userId,
        endedAt: null,
        ...(keepSessionId ? { id: { not: keepSessionId } } : {}),
      },
      data: { endedAt: new Date(), endReason: reason },
    });
  },

  endSession(sessionId, reason) {
    return prisma.authSession.update({
      where: { id: sessionId },
      data: { endedAt: new Date(), endReason: reason },
    });
  },

  touchSession(sessionId) {
    return prisma.authSession.update({
      where: { id: sessionId },
      data: { lastSeenAt: new Date() },
    });
  },

  countRecentFailures(username, since) {
    return prisma.activityLog.count({
      where: { action: 'LOGIN_FAILED', summary: username, createdAt: { gte: since } },
    });
  },

  /**
   * Writes the audit trail — except for the accounts that do not exist.
   *
   * The owner's actions leave no entry at all. Filtering them out when the log
   * is *read* would be the obvious approach and the wrong one: the row would
   * still be in the table, visible to anyone who opens the database panel, and
   * one forgotten query away from the interface. Not writing it is the only
   * version that is true.
   *
   * The trade this makes, stated plainly because it is real: the owner has no
   * audit trail of their own. Their actions still have effects — an agency that
   * gets suspended knows it is suspended — but there is no record of who did it
   * or when.
   *
   * The role lookup is memoised. A user's role changes about never, and this is
   * called on every meaningful action; one primary-key read per user per
   * process is the right price for not threading the role through twenty-seven
   * call sites.
   */
  async recordActivity({ userId, action, targetType, targetId, summary, changes, ip, device }) {
    // Where it came from, taken from the request rather than passed in.
    //
    // Every caller but the login controller used to leave `ip` undefined,
    // because they are services and have no `req` — so the panel showed «IP: —»
    // on almost every row. The context is async-local (see utils/requestContext)
    // and is null outside a request, which is the right answer for a nightly
    // job: no address, rather than a wrong one.
    const at = requestContext.current();
    const from = { ip: ip ?? at?.ip ?? null, device: device ?? at?.device ?? null };
    // Only fields that actually moved, and only when there are any. An edit
    // that changed nothing writes no diff at all.
    const diff = changes && changes.length ? changes : undefined;

    if (userId && (await isHiddenActor(userId))) {
      // Except for the entries the lockout counts.
      //
      // Dropping these would have quietly removed brute-force protection from
      // the single most privileged account in the system — the owner would
      // have been the one account nobody could ever lock out. So the row is
      // still written, with no actor attached.
      //
      // Nothing is lost by that: countRecentFailures matches on `summary`,
      // which is the attempted username, and never on userId. And an anonymous
      // LOGIN_FAILED row proves nothing about whether the account exists,
      // because one is written for every username anybody tries.
      if (!SECURITY_ACTIONS.has(action)) return null;
      return prisma.activityLog.create({
        data: { userId: null, action, targetType, targetId, summary, ...from, changes: diff },
      });
    }

    return prisma.activityLog.create({
      data: { userId, action, targetType, targetId, summary, ...from, changes: diff },
    });
  },

  updatePassword(userId, passwordHash) {
    return prisma.user.update({
      where: { id: userId },
      data: { passwordHash, mustChangePassword: false },
    });
  },

  touchLogin(userId) {
    return prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
  },
};

module.exports = authRepository;
module.exports.forgetHiddenActor = forgetHiddenActor;
