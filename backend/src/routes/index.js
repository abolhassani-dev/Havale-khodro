const { Router } = require('express');

const healthRoutes = require('./health.routes');
const authRoutes = require('../modules/auth/auth.routes');
const havaleRoutes = require('../modules/havale/havale.routes');
const catalogRoutes = require('../modules/catalog/catalog.routes');
const smsRoutes = require('../modules/sms/sms.routes');
const subscriptionRoutes = require('../modules/subscription/subscription.routes');
const subagentRoutes = require('../modules/subagent/subagent.routes');
const settingsRoutes = require('../modules/settings/settings.routes');
const reportRoutes = require('../modules/report/report.routes');
const ticketRoutes = require('../modules/ticket/ticket.routes');

const router = Router();

router.use('/health', healthRoutes);
router.use('/auth', authRoutes);
router.use('/havales', havaleRoutes);
router.use('/catalog', catalogRoutes);
router.use('/sms', smsRoutes);
router.use('/subscriptions', subscriptionRoutes);
router.use('/sub-agents', subagentRoutes);
router.use('/settings', settingsRoutes);
router.use('/reports', reportRoutes);
router.use('/tickets', ticketRoutes);

module.exports = router;
