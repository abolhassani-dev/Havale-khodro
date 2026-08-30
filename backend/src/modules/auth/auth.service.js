const bcrypt = require('bcryptjs');
const { threats } = require('../../middlewares/threatDetect');

const config = require('../../config');
const authRepository = require('./auth.repository');
const { generateToken, hashToken } = require('../../utils/token');
const { toPublicUser } = require('../user/user.dto');
const { UnauthorizedError, ForbiddenError, BadRequestError } = require('../../errors/AppError');
const { ERROR_CODES } = require('../../constants/errorCodes');
const { MESSAGES } = require('../../constants/messages');
const { ROLES, isAdmin } = require('../../constants/roles');

const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
const LOCKOUT_THRESHOLD = 5;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

// Comparing against a real-shaped hash even when the user does not exist keeps
// the response time the same either way. Without it, a fast rejection tells an
// attacker the username is not registered.
const DUMMY_HASH = '$2a$10$CwTycUXWue0Thq9StjUM0uJ8.9pT7Y0qO3aOhH6cVJfE0hZLNqk7C';

/**
 * Authentication.
 *
 * There is no public registration in this system: accounts are created by an
 * admin in exchange for a subscription. That is a product rule (blueprint 2.1),
 * not an omission — so there is deliberately no `register` here.
 */
const authService = {
  async login({ username, password, ip, userAgent }) {
    const since = new Date(Date.now() - LOCKOUT_WINDOW_MS);
    const failures = await authRepository.countRecentFailures(username, since);

    // Check the lockout before the password, so a locked account cannot be used
    // as an oracle telling the attacker when a guess was right.
    if (failures >= LOCKOUT_THRESHOLD) {
      throw new UnauthorizedError(MESSAGES.AUTH.LOCKED_OUT);
    }

    const user = await authRepository.findByUsername(username);
    const passwordOk = await bcrypt.compare(password, user ? user.passwordHash : DUMMY_HASH);

    if (!user || !passwordOk) {
      await authRepository.recordActivity({
        userId: user ? user.id : null,
        action: 'LOGIN_FAILED',
        summary: username,
        ip,
      });
      // Reported from here rather than sniffed from the response, because the
      // distinction that matters — a wrong password, as against a refused
      // permission — is one only this branch knows. The address comes from the
      // request context, so no `req` has to be threaded down into a service.
      threats.loginFailed(username);
      // One message for both cases — distinguishing them reveals which usernames
      // are registered.
      throw new UnauthorizedError(MESSAGES.AUTH.INVALID_CREDENTIALS);
    }

    // A suspended agency is let in. A suspended member of staff is not.
    //
    // They are different events wearing the same word. Suspending a staff
    // account means «you no longer work here», and there is nothing for that
    // person to read. Suspending an agency is a penalty for three confirmed
    // violations, and shutting the door on it produces the worst possible
    // outcome: the agency cannot see the reports, cannot see the count, and
    // cannot open the appeal ticket the rules give them — so they telephone,
    // and somebody has to explain by voice what the screen could have said.
    //
    // Nothing is opened by this. `resolveAccess` gives a suspended account no
    // entitlement at all, so every guard in the system already refuses it:
    // no posting, no renewing, no reporting, and no contact details in any
    // serialised row. What they get is the reason and a way to answer it.
    if (user.status !== 'ACTIVE' && isAdmin(user.role)) {
      throw new ForbiddenError(MESSAGES.AUTH.ACCOUNT_SUSPENDED);
    }

    const token = generateToken();
    const session = await authRepository.createSession({
      userId: user.id,
      tokenHash: hashToken(token),
      ip,
      userAgent,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    });

    // One live session per agent (blueprint 3.3). Signing in anywhere ends every
    // other session at once — which also means a stolen token stops working the
    // moment the real user next signs in.
    //
    // Admin accounts are exempt (blueprint 3.6) so the same person can work from
    // a phone and a laptop without fighting themselves.
    if (user.role === ROLES.AGENT) {
      await authRepository.revokeOtherSessions(user.id, session.id, 'KICKED');
    }

    await authRepository.touchLogin(user.id);
    await authRepository.recordActivity({
      userId: user.id,
      action: 'LOGIN',
      summary: user.username,
      ip,
    });

    return { token, user: toPublicUser(user), mustChangePassword: user.mustChangePassword };
  },

  /**
   * Resolve a session token to its user, or say precisely why it failed.
   *
   * The distinction matters to the interface: a kicked session should say "you
   * signed in elsewhere" rather than the generic "please sign in again", or
   * users think the system logged them out at random.
   */
  async resolveSession(token) {
    if (!token) throw new UnauthorizedError(MESSAGES.AUTH.SESSION_INVALID);

    const session = await authRepository.findLiveSession(hashToken(token));
    if (!session) throw new UnauthorizedError(MESSAGES.AUTH.SESSION_INVALID);

    // Account status is checked before the session state on purpose. Suspending
    // an account also ends its sessions, so checking the session first would
    // answer "your session is invalid" — sending the user to support to find out
    // why, when the interface could have told them. Nothing is leaked by saying
    // it: the account is theirs.
    if (session.user.status !== 'ACTIVE' && isAdmin(session.user.role)) {
      throw new ForbiddenError(MESSAGES.AUTH.ACCOUNT_SUSPENDED);
    }

    if (session.endedAt) {
      if (session.endReason === 'KICKED') {
        throw new UnauthorizedError(MESSAGES.AUTH.SESSION_KICKED, ERROR_CODES.SESSION_KICKED);
      }
      throw new UnauthorizedError(MESSAGES.AUTH.SESSION_INVALID);
    }

    if (session.expiresAt < new Date()) {
      await authRepository.endSession(session.id, 'EXPIRED');
      throw new UnauthorizedError(MESSAGES.AUTH.SESSION_INVALID);
    }

    return { session, user: session.user };
  },

  async logout(token) {
    if (!token) return;
    const session = await authRepository.findLiveSession(hashToken(token));
    if (session && !session.endedAt) {
      await authRepository.endSession(session.id, 'LOGOUT');
      await authRepository.recordActivity({
        userId: session.userId,
        action: 'LOGOUT',
        summary: session.user.username,
      });
    }
  },

  /**
   * Change password — required on first sign-in, because the initial password
   * was set by an admin and is therefore known to someone else (blueprint 2.8).
   */
  async changePassword({ userId, currentPassword, newPassword, currentToken }) {
    const user = await authRepository.findUserById(userId);
    if (!user) throw new UnauthorizedError();

    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) throw new BadRequestError(MESSAGES.AUTH.INVALID_CREDENTIALS);

    if (currentPassword === newPassword) {
      throw new BadRequestError('رمز جدید باید با رمز فعلی متفاوت باشد');
    }

    const passwordHash = await bcrypt.hash(newPassword, config.security.bcryptRounds);
    await authRepository.updatePassword(user.id, passwordHash);

    // Every other session dies on a password change. If the reason for changing
    // it was that someone else knew it, leaving their session alive defeats the
    // point of changing it.
    const current = currentToken
      ? await authRepository.findLiveSession(hashToken(currentToken))
      : null;
    await authRepository.revokeOtherSessions(user.id, current ? current.id : null, 'ADMIN_REVOKED');

    await authRepository.recordActivity({
      userId: user.id,
      action: 'PASSWORD_CHANGED',
      summary: user.username,
    });

    return { changed: true };
  },

  async me(userId) {
    const user = await authRepository.findUserById(userId);
    if (!user) throw new UnauthorizedError();
    return toPublicUser(user);
  },
};

module.exports = authService;
