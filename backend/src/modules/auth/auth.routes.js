const { Router } = require('express');

const controller = require('./auth.controller');
const schema = require('./auth.validator');
const validate = require('../../middlewares/validate');
const { authenticate } = require('../../middlewares/auth');
const { authLimiter } = require('../../middlewares/rateLimiter');

const router = Router();

/**
 * @openapi
 * /auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Sign in with username and password
 *     description: >
 *       Sets an httpOnly session cookie. For agent accounts this ends every other
 *       live session for the same account — one session per account is a product
 *       rule, not a limitation.
 *     security: []
 *     responses:
 *       200: { description: Signed in }
 *       401: { description: Invalid credentials or locked out }
 *       403: { description: Account suspended }
 */
router.post('/login', authLimiter, validate(schema.login), controller.login);

/**
 * @openapi
 * /auth/logout:
 *   post:
 *     tags: [Auth]
 *     summary: End the current session
 *     responses:
 *       200: { description: Signed out }
 */
router.post('/logout', controller.logout);

/**
 * @openapi
 * /auth/change-password:
 *   post:
 *     tags: [Auth]
 *     summary: Change password
 *     description: Required on first sign-in. Ends all other sessions.
 *     responses:
 *       200: { description: Changed }
 *       400: { description: Current password is wrong }
 */
router.post(
  '/change-password',
  authenticate,
  validate(schema.changePassword),
  controller.changePassword
);

/**
 * @openapi
 * /auth/me:
 *   get:
 *     tags: [Auth]
 *     summary: The signed-in user
 *     responses:
 *       200: { description: Profile }
 *       401: { description: Not signed in, or signed in elsewhere }
 */
router.get('/me', authenticate, controller.me);

module.exports = router;
