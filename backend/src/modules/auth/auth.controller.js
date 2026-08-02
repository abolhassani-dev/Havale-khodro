const authService = require('./auth.service');
const asyncHandler = require('../../utils/asyncHandler');
const { success } = require('../../responses/apiResponse');
const { MESSAGES } = require('../../constants/messages');
const config = require('../../config');
const logger = require('../../utils/logger');

/**
 * The session cookie.
 *
 * httpOnly keeps it out of reach of JavaScript, so an XSS bug cannot read it.
 * sameSite=strict means a browser will not attach it to a request originating
 * from another site, which is what stops cross-site request forgery.
 *
 * `secure` follows the actual connection rather than NODE_ENV, and that
 * distinction cost a deployment. Tied to NODE_ENV it was true the moment the
 * server ran in production — but a browser refuses to *store* a Secure cookie
 * that arrived over plain HTTP, so signing in returned 200 and the very next
 * request came back 401 with no cookie attached. The symptom pointed at the
 * session logic; the cause was three layers away.
 *
 * Reading it from the request means HTTP works before a certificate exists and
 * every cookie becomes Secure the moment HTTPS is switched on, with no flag for
 * anyone to set — or to forget to unset. `req.secure` is trustworthy here
 * because the app trusts the proxy and nginx sends X-Forwarded-Proto.
 */
let warnedAboutPlainHttp = false;

function cookieOptions(req) {
  const secure = Boolean(req.secure);

  if (config.isProduction && !secure && !warnedAboutPlainHttp) {
    // Once per process: this is expected during the window before a certificate
    // is issued, and unacceptable after. Saying it every login would train
    // people to ignore it.
    warnedAboutPlainHttp = true;
    logger.warn(
      'Session cookie issued without the Secure flag because the request arrived over plain HTTP. ' +
        'This is expected before TLS is configured. Once HTTPS is live it corrects itself.'
    );
  }

  return {
    httpOnly: true,
    secure,
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

    res.cookie(config.session.cookieName, result.token, cookieOptions(req));

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
