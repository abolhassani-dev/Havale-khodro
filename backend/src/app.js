const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');

const config = require('./config');
const logger = require('./utils/logger');
const routes = require('./routes');
const swagger = require('./docs/swagger');
const requestId = require('./middlewares/requestId');
const rateLimiter = require('./middlewares/rateLimiter');
const notFound = require('./middlewares/notFound');
const errorHandler = require('./middlewares/errorHandler');

const app = express();

// Behind a reverse proxy the client IP arrives in a header; without this the
// rate limiter would see the proxy's IP for everyone and throttle collectively.
app.set('trust proxy', 1);

app.use(helmet());
app.use(cors({ origin: config.security.corsOrigins, credentials: true }));
app.use(compression());
app.use(express.json({ limit: config.security.bodyLimit }));
app.use(express.urlencoded({ extended: true, limit: config.security.bodyLimit }));

app.use(cookieParser(config.session.secret));

app.use(requestId);
app.use(morgan(config.isProduction ? 'combined' : 'dev', { stream: logger.stream }));
app.use(rateLimiter);

swagger(app);
app.use(config.apiPrefix, routes);

// Order matters: unmatched routes become a 404, and everything thrown anywhere
// above lands in the error handler, which is the only place that formats errors.
app.use(notFound);
app.use(errorHandler);

module.exports = app;
