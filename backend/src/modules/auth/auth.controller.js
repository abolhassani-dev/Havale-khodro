const authService = require('./auth.service');
const asyncHandler = require('../../utils/asyncHandler');
const { success } = require('../../responses/apiResponse');
const { MESSAGES } = require('../../constants/messages');
const config = require('../../config');

/**
 * The session cookie.
 *
 * httpOnly keeps it out of reach of JavaScript, so an XSS bug cannot read it.
 * sameSite=strict means a browser will not attach it to a request originating
 * from another site, which is what stops cross-site request forgery.
 * secure is on in production; leaving it on in development would break plain
 * HTTP on localhost.
 */
function cookieOptions() {
  return {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'strict',
    path: '/',
    maxAge: config.session.ttlMs,
  };
}

const authController = {
  login: asyncHandler(async (req, res) => {
    const result = await authService.login({
      username: req.body.username,
      password: req.body.password,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.cookie(config.session.cookieName, result.token, cookieOptions());

    // The token goes in the cookie and nowhere else. Returning it in the body
    // too would invite the frontend to store it somewhere readable, undoing the
    // reason for httpOnly.
    return success(
      res,
      { user: result.user, mustChangePassword: result.mustChangePassword },
      MESSAGES.AUTH.LOGGED_IN
    );
  }),

  logout: asyncHandler(async (req, res) => {
    await authService.logout(req.cookies[config.session.cookieName]);
    res.clearCookie(config.session.cookieName, { path: '/' });
    return success(res, null, MESSAGES.AUTH.LOGGED_OUT);
  }),

  changePassword: asyncHandler(async (req, res) => {
    await authService.changePassword({
      userId: req.user.id,
      currentPassword: req.body.currentPassword,
      newPassword: req.body.newPassword,
      currentToken: req.cookies[config.session.cookieName],
    });
    return success(res, null, MESSAGES.AUTH.PASSWORD_CHANGED);
  }),

  me: asyncHandler(async (req, res) => {
    const user = await authService.me(req.user.id);
    return success(res, user);
  }),
};

module.exports = authController;
