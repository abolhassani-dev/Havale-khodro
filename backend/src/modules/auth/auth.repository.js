const { prisma } = require('../../config/database');

/**
 * Database access for authentication: users by username, sessions, and the
 * failed-login trail used for lockout.
 *
 * No rules live here. Whether a lockout applies is the service's decision; this
 * layer only counts.
 */
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

  recordActivity({ userId, action, targetType, targetId, summary, ip }) {
    return prisma.activityLog.create({
      data: { userId, action, targetType, targetId, summary, ip },
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
