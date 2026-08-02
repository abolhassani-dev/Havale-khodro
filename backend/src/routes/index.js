const { Router } = require('express');

const healthRoutes = require('./health.routes');
const authRoutes = require('../modules/auth/auth.routes');
const havaleRoutes = require('../modules/havale/havale.routes');

const router = Router();

router.use('/health', healthRoutes);
router.use('/auth', authRoutes);
router.use('/havales', havaleRoutes);

module.exports = router;
