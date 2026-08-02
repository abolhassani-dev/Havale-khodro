const { Router } = require('express');

const healthRoutes = require('./health.routes');
const authRoutes = require('../modules/auth/auth.routes');
const havaleRoutes = require('../modules/havale/havale.routes');
const catalogRoutes = require('../modules/catalog/catalog.routes');
const smsRoutes = require('../modules/sms/sms.routes');

const router = Router();

router.use('/health', healthRoutes);
router.use('/auth', authRoutes);
router.use('/havales', havaleRoutes);
router.use('/catalog', catalogRoutes);
router.use('/sms', smsRoutes);

module.exports = router;
