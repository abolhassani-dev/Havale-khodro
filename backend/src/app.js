const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');

const config = require('./config');
const logger = require('./utils/logger');
const routes = require('./routes');
const swagger = require('./docs/swagger');
const requestId = require('./middlewares/requestId');
const { requestContext } = require('./utils/requestContext');
const rateLimiter = require('./middlewares/rateLimiter');
const slowRequest = require('./middlewares/slowRequest');
const blockedIp = require('./middlewares/blockedIp');
const threatDetect = require('./middlewares/threatDetect');
const notFound = require('./middlewares/notFound');
const errorHandler = require('./middlewares/errorHandler');

const app = express();

// Behind a reverse proxy the client IP arrives in a header; without this the
// rate limiter would see the proxy's IP for everyone and throttle collectively.
app.set('trust proxy', 1);

// First of all, and before anything reads the request: an address somebody
// closed the door on should cost this server as little as possible.
app.use(blockedIp);

app.use(helmet());
app.use(cors({ origin: config.security.corsOrigins, credentials: true }));
// Compression is nginx's job, not this process's.
//
// It used to be `compression()` right here, and under load that was the single
// most expensive thing the API did: zlib at level 6 on every JSON response,
// paid by the same container that has to answer the next request. nginx sits
// in front of every response anyway, compresses at a cheaper level, and was
// measured at under ten percent of one core while the API was using two.
// Removed rather than made conditional — a switch here would only ever be a
// way to turn the expensive one back on by accident.
app.use(express.json({ limit: config.security.bodyLimit }));
app.use(express.urlencoded({ extended: true, limit: config.security.bodyLimit }));

app.use(cookieParser(config.session.secret));

app.use(requestId);
// Directly after requestId and before anything that could write a log line:
// from here down, any code — however deep — can ask where the request came
// from, which is what puts an address on all thirty-six kinds of activity log
// instead of only on the one written by the login controller.
app.use(requestContext);
app.use(morgan(config.isProduction ? 'combined' : 'dev', { stream: logger.stream }));
app.use(slowRequest);
// After the body parsers, because half of what an attack looks like is in the
// body — and before the routes, so a payload is recorded whether the handler
// ends up refusing it, validating it away, or answering 404.
app.use(threatDetect);
app.use(rateLimiter);

swagger(app);
app.use(config.apiPrefix, routes);

// Order matters: unmatched routes become a 404, and everything thrown anywhere
// above lands in the error handler, which is the only place that formats errors.
app.use(notFound);
app.use(errorHandler);

module.exports = app;
