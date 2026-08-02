const { Router } = require('express');

const healthRoutes = require('./health.routes');
const authRoutes = require('../modules/auth/auth.routes');

const router = Router();

router.use('/health', healthRoutes);
router.use('/auth', authRoutes);

module.exports = router;
