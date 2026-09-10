"""File templates for the project scaffolder.

Every template uses {{TOKEN}} placeholders substituted by scaffold.py. Kept apart from the
generator so the content is editable without touching the tree-building logic.
"""

# --------------------------------------------------------------------------- #
# Folder responsibilities — become each folder's README.md
# --------------------------------------------------------------------------- #

BACKEND_FOLDERS = {
    "config": (
        "Configuration and environment loading",
        "Reads the environment once at boot and validates it. Database, JWT, Redis, mail, "
        "storage, feature flags, logging, external services.",
        "Reading `process.env` anywhere else in the codebase. Scattered environment access "
        "makes it impossible to know what a deployment requires.",
    ),
    "controllers": (
        "HTTP entry points",
        "Read the request, call one service method, return a response through the response "
        "builders.",
        "Business rules, database queries, external API calls, transactions, validation.",
    ),
    "services": (
        "Business logic",
        "Business rules, orchestration across repositories, transactions, cache "
        "invalidation, queue dispatch, mail, notifications, third-party integrations.",
        "Anything HTTP. No `req`, no `res`, no status codes — a service that knows about "
        "HTTP cannot be called from a worker, a job, or a test.",
    ),
    "repositories": (
        "Database access",
        "Every read and write. Query construction, joins, projections, pagination.",
        "Business logic. A repository deletes the user; it does not decide whether the user "
        "may be deleted.",
    ),
    "models": (
        "Schema definitions",
        "ORM models, relations, indexes, schema-level validation.",
        "Behaviour. Structure only — logic lives in services.",
    ),
    "validators": (
        "Request validation",
        "Schema validation of body, params, and query for every route.",
        "Nothing — but note that validation must not appear anywhere else. Inline validation "
        "drifts between endpoints and diverges silently.",
    ),
    "middlewares": (
        "Cross-cutting request concerns",
        "Authentication, authorization, permissions, rate limiting, security headers, CORS, "
        "compression, body parsing, request logging, global error handling.",
        "Domain-specific logic. If it only applies to one resource, it belongs in that "
        "module.",
    ),
    "routes": (
        "URL mapping",
        "Route definitions, API versioning, grouping, middleware attachment, Swagger tags.",
        "Logic of any kind. Routes point at controllers.",
    ),
    "utils": (
        "Pure helpers",
        "Small dependency-free functions: dates, strings, numbers, hashing wrappers, "
        "formatters, the logger.",
        "Anything needing config, a model, or the database. The test: a util should move to "
        "another project unchanged.",
    ),
    "constants": (
        "Fixed values with meaning",
        "Roles, permissions, enums, statuses, messages, error codes.",
        "Anything computed or environment-dependent — that is config.",
    ),
    "interfaces": (
        "Contracts",
        "Shared abstractions describing what an implementation must provide.",
        "Concrete implementations.",
    ),
    "types": (
        "Shared types and DTOs",
        "The shapes that cross layer boundaries.",
        "Runtime logic.",
    ),
    "errors": (
        "Error classes and codes",
        "`AppError` and its subclasses, each carrying an HTTP status, a machine-readable "
        "code, and a client-safe message.",
        "Error handling itself — that is the global error middleware.",
    ),
    "responses": (
        "Response builders",
        "Success, error, and paginated envelopes so every endpoint returns the same shape.",
        "Business logic or data fetching.",
    ),
    "helpers": (
        "Shared modules with app context",
        "The middle ground between a pure util and a full service.",
        "Business rules. A growing helpers folder usually means a service is missing.",
    ),
    "events": (
        "Domain events",
        "Event definitions and listeners, decoupling side effects from the main flow.",
        "The main flow itself. Registration fires an event; it does not send the email.",
    ),
    "jobs": (
        "Scheduled tasks",
        "Cron definitions and the work they trigger.",
        "Non-idempotent work. Jobs will run twice — after a restart, a deploy, an overlap.",
    ),
    "queues": (
        "Background queues",
        "Queue definitions and workers for slow, retryable, or third-party-dependent work.",
        "Anything that must complete before the response is sent.",
    ),
    "cache": (
        "Caching layer",
        "Cache clients, key construction, and invalidation rules.",
        "Scattered key strings. Build keys in one place or stale data is guaranteed.",
    ),
    "sockets": (
        "Realtime handlers",
        "Connection handling, rooms, and event handlers.",
        "Business logic. Socket handlers call services, exactly as controllers do.",
    ),
    "hooks": (
        "Lifecycle hooks",
        "Startup, graceful shutdown, connection management.",
        "Request handling.",
    ),
    "docs": (
        "API documentation",
        "OpenAPI/Swagger definitions.",
        "Hand-maintained duplicates of route definitions — generate from annotations so the "
        "docs cannot drift.",
    ),
    "modules": (
        "Business modules",
        "Self-contained domains, each with its own controller, routes, service, repository, "
        "validator, DTO, model, and tests.",
        "Cross-module imports of internals. Modules talk through their public surface.",
    ),
}

FRONTEND_FOLDERS = {
    "components": ("Shared presentational components", "Reusable UI that receives props and renders.", "Data fetching or business rules."),
    "layouts": ("Page shells", "Sidebar, header, auth and dashboard layouts.", "Feature logic."),
    "pages": ("Route entry points", "Compose a layout with a feature. Thin.", "Logic — it becomes untestable without a router."),
    "features": ("Feature slices", "Self-contained domains, each exporting through index.js.", "Imports from other features. Shared code moves to the shared layer."),
    "hooks": ("Shared hooks", "Hooks used by more than one feature.", "Feature-specific hooks — those live in the feature."),
    "services": ("Client business logic", "Orchestration above the API layer.", "Direct HTTP calls — those go through api/."),
    "api": ("HTTP layer", "Client instance, endpoints, interceptors, error normalization.", "Business logic."),
    "contexts": ("React contexts", "Context definitions.", "Provider composition — that is providers/."),
    "providers": ("Provider composition", "Where providers are assembled and ordered.", "Context definitions."),
    "store": ("Global client state", "Auth session, theme, UI preferences.", "Server data — that belongs in a data-fetching layer with caching."),
    "routes": ("Route definitions", "Route table, guards, lazy loading, path constants.", "Page components."),
    "validators": ("Form validation", "Schemas for forms and inputs.", "Submission logic."),
    "types": ("Shared types", "Types and DTOs crossing boundaries.", "Runtime logic."),
    "constants": ("Fixed values", "Enums, roles, route paths, config values.", "Anything environment-dependent."),
    "utils": ("Pure helpers", "Formatting, dates, small transforms.", "Anything touching React or the network."),
    "styles": ("Global styling", "Theme, design tokens, resets, global CSS.", "Component-scoped styles."),
    "assets": ("Static assets", "Images, fonts, icons.", "Code."),
    "tests": ("Test setup", "Setup files, render helpers, mock handlers.", "The tests themselves — those sit beside what they test."),
}

FOLDER_README = """# {name}/

**Responsibility:** {responsibility}

{detail}

**Does not belong here:** {excluded}

---
_Part of the {{{{PROJECT_NAME}}}} architecture standard. See `backend/README.md` for the full layout._
"""

# --------------------------------------------------------------------------- #
# Root files
# --------------------------------------------------------------------------- #

GITIGNORE = """node_modules/
dist/
build/
coverage/
.nyc_output/

.env
.env.local
.env.*.local

*.log
logs/
npm-debug.log*

.DS_Store
.idea/
.vscode/
*.swp

uploads/
tmp/
"""

DOCKERIGNORE = """node_modules
npm-debug.log
.git
.gitignore
.env
coverage
tests
*.md
Dockerfile
docker-compose.yml
"""

ENV_EXAMPLE = """# ---- Application ----
NODE_ENV=development
PORT=3000
API_PREFIX=/api/v1

# ---- Database ----
{{DB_ENV}}

# ---- Auth ----
# Generate with: openssl rand -hex 32
JWT_SECRET=change-me-to-a-long-random-string
JWT_EXPIRES_IN=15m
JWT_REFRESH_SECRET=change-me-too
JWT_REFRESH_EXPIRES_IN=7d
BCRYPT_ROUNDS=10

# ---- Security ----
CORS_ORIGINS=http://localhost:5173
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=100
BODY_LIMIT=1mb

# ---- Logging ----
LOG_LEVEL=info
"""

DB_ENV = {
    "mongo": "MONGO_URI=mongodb://localhost:27017/{{PROJECT_NAME}}",
    "postgres": 'DATABASE_URL="postgresql://postgres:postgres@localhost:5432/{{PROJECT_NAME}}?schema=public"',
    "mysql": 'DATABASE_URL="mysql://root:root@localhost:3306/{{PROJECT_NAME}}"',
    "sqlite": 'DATABASE_URL="file:./dev.db"',
}

PACKAGE_JSON = """{
  "name": "{{PROJECT_NAME}}",
  "version": "0.1.0",
  "private": true,
  "description": "{{PROJECT_NAME}} backend",
  "main": "server.js",
  "type": "commonjs",
  "engines": { "node": ">=20" },
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js",
    "test": "jest --runInBand",
    "test:unit": "jest tests/unit",
    "test:integration": "jest tests/integration",
    "test:e2e": "jest tests/e2e",
    "test:coverage": "jest --coverage",
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "format": "prettier --write \\"**/*.{js,json,md}\\"",
    "seed": "node scripts/seed.js"
  },
  "dependencies": {
    "bcryptjs": "^2.4.3",
    "compression": "^1.7.4",
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "express-rate-limit": "^7.4.0",
    "helmet": "^7.1.0",
    "joi": "^17.13.3",
    "jsonwebtoken": "^9.0.2",
    "morgan": "^1.10.0",
    "swagger-jsdoc": "^6.2.8",
    "swagger-ui-express": "^5.0.1",
    "winston": "^3.14.2"{{EXTRA_DEPS}}
  },
  "devDependencies": {
    "eslint": "^8.57.0",
    "jest": "^29.7.0",
    "nodemon": "^3.1.4",
    "prettier": "^3.3.3",
    "supertest": "^7.0.0"{{EXTRA_DEV_DEPS}}
  }
}
"""

EXTRA_DEPS = {
    "mongo": ',\n    "mongoose": "^8.6.0"',
    "postgres": ',\n    "@prisma/client": "^5.19.0"',
    "mysql": ',\n    "@prisma/client": "^5.19.0"',
    "sqlite": ',\n    "@prisma/client": "^5.19.0"',
}

# The Prisma CLI must be pinned alongside the client. Left to `npx`, it resolves
# to whatever is newest, and a CLI a major version ahead of the client generates
# output the client cannot use — an obscure failure to debug.
EXTRA_DEV_DEPS = {
    "mongo": "",
    "postgres": ',\n    "prisma": "^5.19.0"',
    "mysql": ',\n    "prisma": "^5.19.0"',
    "sqlite": ',\n    "prisma": "^5.19.0"',
}

DOCKERFILE = """# ---- dependencies ----
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# ---- runtime ----
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Run as a non-root user: a container breakout should not land on root.
RUN addgroup -g 1001 -S nodejs && adduser -S app -u 1001

COPY --from=deps /app/node_modules ./node_modules
COPY --chown=app:nodejs . .

USER app
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \\
  CMD node -e "require('http').get('http://localhost:3000/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "server.js"]
"""

COMPOSE = """services:
  api:
    build: .
    container_name: {{PROJECT_NAME}}-api
    restart: unless-stopped
    ports:
      - "${PORT:-3000}:3000"
    env_file: .env
    depends_on:
      db:
        condition: service_healthy
    networks: [appnet]

{{DB_SERVICE}}
networks:
  appnet:
    driver: bridge

volumes:
  dbdata:
"""

DB_SERVICE = {
    "mongo": """  db:
    image: mongo:7
    container_name: {{PROJECT_NAME}}-db
    restart: unless-stopped
    volumes:
      - dbdata:/data/db
    healthcheck:
      test: ["CMD", "mongosh", "--eval", "db.adminCommand('ping')"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks: [appnet]

""",
    "postgres": """  db:
    image: postgres:16-alpine
    container_name: {{PROJECT_NAME}}-db
    restart: unless-stopped
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: {{PROJECT_NAME}}
    volumes:
      - dbdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks: [appnet]

""",
    "mysql": """  db:
    image: mysql:8
    container_name: {{PROJECT_NAME}}-db
    restart: unless-stopped
    environment:
      MYSQL_ROOT_PASSWORD: root
      MYSQL_DATABASE: {{PROJECT_NAME}}
    volumes:
      - dbdata:/var/lib/mysql
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks: [appnet]

""",
    "sqlite": "",
}

ESLINTRC = """{
  "env": { "node": true, "es2022": true, "jest": true },
  "parserOptions": { "ecmaVersion": 2022, "sourceType": "script" },
  "extends": "eslint:recommended",
  "rules": {
    "no-unused-vars": ["warn", { "argsIgnorePattern": "^_|^next$" }],
    "no-console": "warn",
    "eqeqeq": "error",
    "prefer-const": "error",
    "no-var": "error"
  }
}
"""

PRETTIERRC = """{
  "semi": true,
  "singleQuote": true,
  "printWidth": 100,
  "trailingComma": "es5",
  "arrowParens": "always"
}
"""

JEST_CONFIG = """module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  collectCoverageFrom: ['src/**/*.js', '!src/docs/**'],
  coverageThreshold: {
    // Deliberately modest. A high number that skips the authorization checks is
    // worse than an honest one that includes them.
    global: { branches: 50, functions: 50, lines: 60, statements: 60 },
  },
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
};
"""

# --------------------------------------------------------------------------- #
# Source files
# --------------------------------------------------------------------------- #

SERVER_JS = """require('dotenv').config();

const app = require('./src/app');
const config = require('./src/config');
const logger = require('./src/utils/logger');
const { connectDatabase, disconnectDatabase } = require('./src/config/database');
const registerShutdown = require('./src/hooks/shutdown');

async function start() {
  await connectDatabase();

  const server = app.listen(config.port, () => {
    logger.info(`{{PROJECT_NAME}} listening on port ${config.port} [${config.env}]`);
    logger.info(`Docs at http://localhost:${config.port}/docs`);
  });

  registerShutdown(server, disconnectDatabase);
}

start().catch((err) => {
  logger.error('Failed to start', { error: err.message, stack: err.stack });
  process.exit(1);
});
"""

APP_JS = """const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
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
"""

CONFIG_INDEX = """/**
 * Single source of configuration.
 *
 * Everything reads the environment here and nowhere else, so one file answers
 * "what does a deployment of this service actually need?". Required values are
 * checked at boot — a missing secret should stop the process immediately rather
 * than surface later as a confusing runtime failure.
 */

const required = ['JWT_SECRET'{{REQUIRED_DB_ENV}}];

const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
}

const env = process.env.NODE_ENV || 'development';

module.exports = {
  env,
  isProduction: env === 'production',
  isTest: env === 'test',
  port: Number(process.env.PORT) || 3000,
  apiPrefix: process.env.API_PREFIX || '/api/v1',

  database: {
{{DB_CONFIG}}
  },

  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },

  security: {
    bcryptRounds: Number(process.env.BCRYPT_ROUNDS) || 10,
    corsOrigins: (process.env.CORS_ORIGINS || '*').split(',').map((s) => s.trim()),
    bodyLimit: process.env.BODY_LIMIT || '1mb',
    rateLimit: {
      windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
      max: Number(process.env.RATE_LIMIT_MAX) || 100,
    },
  },

  logging: {
    level: process.env.LOG_LEVEL || 'info',
  },
};
"""

DB_CONFIG_BLOCK = {
    "mongo": "    uri: process.env.MONGO_URI,",
    "postgres": "    url: process.env.DATABASE_URL,",
    "mysql": "    url: process.env.DATABASE_URL,",
    "sqlite": "    url: process.env.DATABASE_URL,",
}

DATABASE_MONGO = """const mongoose = require('mongoose');
const config = require('./index');
const logger = require('../utils/logger');

async function connectDatabase() {
  mongoose.set('strictQuery', true);
  await mongoose.connect(config.database.uri);
  logger.info('Database connected');
}

async function disconnectDatabase() {
  await mongoose.connection.close();
  logger.info('Database disconnected');
}

module.exports = { connectDatabase, disconnectDatabase, mongoose };
"""

DATABASE_PRISMA = """const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');

// A single client for the process. Creating one per request exhausts the
// database's connection limit under load — the most common way an app like this
// falls over in production.
const prisma = new PrismaClient();

async function connectDatabase() {
  await prisma.$connect();
  logger.info('Database connected');
}

async function disconnectDatabase() {
  await prisma.$disconnect();
  logger.info('Database disconnected');
}

module.exports = { connectDatabase, disconnectDatabase, prisma };
"""

LOGGER = """const winston = require('winston');
const config = require('../config');

// Structured JSON in production so a log aggregator can parse it; readable
// lines in development so a human can.
const format = config.isProduction
  ? winston.format.combine(winston.format.timestamp(), winston.format.json())
  : winston.format.combine(
      winston.format.colorize(),
      winston.format.timestamp({ format: 'HH:mm:ss' }),
      winston.format.printf(({ level, message, timestamp, ...meta }) => {
        const rest = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
        return `${timestamp} ${level} ${message}${rest}`;
      })
    );

const logger = winston.createLogger({
  level: config.logging.level,
  format,
  transports: [new winston.transports.Console()],
  silent: config.isTest,
});

logger.stream = { write: (message) => logger.info(message.trim()) };

module.exports = logger;
"""

APP_ERROR = """const { ERROR_CODES } = require('../constants/errorCodes');

/**
 * Errors the application throws on purpose.
 *
 * `isOperational` separates expected failures (bad input, missing record) from
 * genuine bugs. The error handler can safely show the first kind to the client
 * and must not show the second, because unexpected errors leak internals.
 */
class AppError extends Error {
  constructor(message, statusCode = 500, code = ERROR_CODES.INTERNAL, details = null) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

class BadRequestError extends AppError {
  constructor(message = 'Bad request', details = null) {
    super(message, 400, ERROR_CODES.BAD_REQUEST, details);
  }
}

class ValidationError extends AppError {
  constructor(message = 'Validation failed', details = null) {
    super(message, 422, ERROR_CODES.VALIDATION, details);
  }
}

class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401, ERROR_CODES.UNAUTHORIZED);
  }
}

class ForbiddenError extends AppError {
  constructor(message = 'Not allowed') {
    super(message, 403, ERROR_CODES.FORBIDDEN);
  }
}

class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404, ERROR_CODES.NOT_FOUND);
  }
}

class ConflictError extends AppError {
  constructor(message = 'Resource already exists') {
    super(message, 409, ERROR_CODES.CONFLICT);
  }
}

module.exports = {
  AppError,
  BadRequestError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
};
"""

ERROR_CODES = """// Machine-readable codes. Clients branch on these, not on message text —
// messages get reworded, codes do not.
const ERROR_CODES = {
  INTERNAL: 'INTERNAL_ERROR',
  BAD_REQUEST: 'BAD_REQUEST',
  VALIDATION: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
};

module.exports = { ERROR_CODES };
"""

ROLES = """const ROLES = {
  ADMIN: 'admin',
  USER: 'user',
};

const ROLE_VALUES = Object.values(ROLES);

module.exports = { ROLES, ROLE_VALUES };
"""

MESSAGES = """// Kept here rather than inline so wording changes happen in one place and
// typos cannot silently create a second, different message.
const MESSAGES = {
  AUTH: {
    REGISTERED: 'Account created',
    LOGGED_IN: 'Signed in',
    LOGGED_OUT: 'Signed out',
    INVALID_CREDENTIALS: 'Email or password is incorrect',
    EMAIL_TAKEN: 'That email is already registered',
    TOKEN_INVALID: 'Session is invalid or expired',
  },
  USER: {
    CREATED: 'User created',
    UPDATED: 'User updated',
    DELETED: 'User deleted',
  },
};

module.exports = { MESSAGES };
"""

API_RESPONSE = """/**
 * One response shape for the whole API.
 *
 * Consumers can rely on `success`, `data`, and `error` always being in the same
 * place, which means no endpoint-by-endpoint guesswork on the client.
 */

function success(res, data = null, message = null, statusCode = 200) {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
  });
}

function created(res, data, message = 'Created') {
  return success(res, data, message, 201);
}

function noContent(res) {
  return res.status(204).send();
}

function paginated(res, items, { page, limit, total }, message = null) {
  return res.status(200).json({
    success: true,
    message,
    data: items,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit) || 0,
      hasNext: page * limit < total,
    },
  });
}

function failure(res, { message, code, statusCode = 500, details = null, requestId = null }) {
  return res.status(statusCode).json({
    success: false,
    error: { code, message, details },
    requestId,
  });
}

module.exports = { success, created, noContent, paginated, failure };
"""

ERROR_HANDLER = """const config = require('../config');
const logger = require('../utils/logger');
const { AppError } = require('../errors/AppError');
const { ERROR_CODES } = require('../constants/errorCodes');
const { failure } = require('../responses/apiResponse');

/**
 * The only place errors become responses.
 *
 * Expected failures carry their own status and code. Anything else is a bug: it
 * gets logged in full and returned as a generic 500, because driver messages and
 * stack traces tell an attacker about your internals.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof AppError && err.isOperational) {
    logger.warn(err.message, { code: err.code, path: req.originalUrl, requestId: req.id });
    return failure(res, {
      message: err.message,
      code: err.code,
      statusCode: err.statusCode,
      details: err.details,
      requestId: req.id,
    });
  }

  logger.error('Unhandled error', {
    message: err.message,
    stack: err.stack,
    path: req.originalUrl,
    requestId: req.id,
  });

  return failure(res, {
    message: config.isProduction ? 'Something went wrong' : err.message,
    code: ERROR_CODES.INTERNAL,
    statusCode: 500,
    requestId: req.id,
  });
}

module.exports = errorHandler;
"""

NOT_FOUND = """const { NotFoundError } = require('../errors/AppError');

function notFound(req, _res, next) {
  next(new NotFoundError(`Route ${req.method} ${req.originalUrl}`));
}

module.exports = notFound;
"""

REQUEST_ID = """const { randomUUID } = require('crypto');

/**
 * Attaches an id to every request and echoes it back.
 *
 * When a user reports "it failed at 3pm", this is what turns that into the exact
 * log lines for that one request.
 */
function requestId(req, res, next) {
  req.id = req.headers['x-request-id'] || randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
}

module.exports = requestId;
"""

RATE_LIMITER = """const rateLimit = require('express-rate-limit');
const config = require('../config');
const { ERROR_CODES } = require('../constants/errorCodes');

const message = {
  success: false,
  error: { code: ERROR_CODES.RATE_LIMITED, message: 'Too many requests, try again later' },
};

const rateLimiter = rateLimit({
  windowMs: config.security.rateLimit.windowMs,
  max: config.security.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  message,
  skip: () => config.isTest,
});

// Auth endpoints get a far tighter limit: they are the ones worth brute forcing,
// and a legitimate user never needs dozens of login attempts in a few minutes.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message,
  skip: () => config.isTest,
});

module.exports = rateLimiter;
module.exports.authLimiter = authLimiter;
"""

AUTH_MIDDLEWARE = """const jwt = require('jsonwebtoken');
const config = require('../config');
const { UnauthorizedError, ForbiddenError } = require('../errors/AppError');
const { MESSAGES } = require('../constants/messages');

/** Verifies the bearer token and attaches the caller to the request. */
function authenticate(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) return next(new UnauthorizedError());

  try {
    req.user = jwt.verify(token, config.jwt.secret);
    return next();
  } catch {
    return next(new UnauthorizedError(MESSAGES.AUTH.TOKEN_INVALID));
  }
}

/**
 * Role check. Note this answers "may this kind of user do this?" — it does not
 * answer "does this user own this record?". Ownership is per-resource and belongs
 * in the service, which is the layer that knows what the resource is.
 */
function authorize(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(new UnauthorizedError());
    if (roles.length && !roles.includes(req.user.role)) return next(new ForbiddenError());
    return next();
  };
}

module.exports = { authenticate, authorize };
"""

VALIDATE_MIDDLEWARE = """const { ValidationError } = require('../errors/AppError');

/**
 * Runs a Joi schema against the request and replaces the raw input with the
 * validated value, so downstream code works with clean, typed data.
 *
 * `stripUnknown` drops fields nobody declared — that stops a client from
 * smuggling extra properties into a create or update call.
 */
function validate(schema) {
  return (req, _res, next) => {
    const targets = ['body', 'params', 'query'];

    for (const target of targets) {
      if (!schema[target]) continue;

      const { error, value } = schema[target].validate(req[target], {
        abortEarly: false,
        stripUnknown: true,
      });

      if (error) {
        return next(
          new ValidationError(
            'Validation failed',
            error.details.map((d) => ({ field: d.path.join('.'), message: d.message }))
          )
        );
      }

      req[target] = value;
    }

    return next();
  };
}

module.exports = validate;
"""

ASYNC_HANDLER = """/**
 * Wraps an async route handler so a rejected promise reaches the error
 * middleware. Without it, an async throw becomes an unhandled rejection and the
 * request hangs until it times out.
 */
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = asyncHandler;
"""

SHUTDOWN_HOOK = """const logger = require('../utils/logger');

/**
 * Graceful shutdown.
 *
 * On deploy the platform sends SIGTERM. Without this, in-flight requests are cut
 * mid-response — users see failures during every release.
 */
function registerShutdown(server, onClose) {
  let shuttingDown = false;

  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`${signal} received, shutting down`);

    server.close(async () => {
      try {
        if (onClose) await onClose();
      } finally {
        process.exit(0);
      }
    });

    // If connections refuse to drain, do not hang forever.
    setTimeout(() => process.exit(1), 10000).unref();
  };

  ['SIGTERM', 'SIGINT'].forEach((sig) => process.on(sig, () => shutdown(sig)));

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', { reason: String(reason) });
  });
}

module.exports = registerShutdown;
"""

ROUTES_INDEX = """const { Router } = require('express');

const healthRoutes = require('./health.routes');
const authRoutes = require('../modules/auth/auth.routes');
const userRoutes = require('../modules/user/user.routes');

const router = Router();

router.use('/health', healthRoutes);
router.use('/auth', authRoutes);
router.use('/users', userRoutes);

module.exports = router;
"""

HEALTH_ROUTES = """const { Router } = require('express');
const { success } = require('../responses/apiResponse');
{{HEALTH_IMPORT}}

const router = Router();

/**
 * @openapi
 * /health:
 *   get:
 *     tags: [System]
 *     summary: Liveness and dependency check
 *     responses:
 *       200: { description: Healthy }
 *       503: { description: A dependency is down }
 */
router.get('/', async (_req, res) => {
  // Checking the database matters: a process that is up but cannot reach its
  // database is not healthy, and a check that always returns 200 hides exactly
  // the outage you needed it to catch.
  let database = 'up';
  try {
{{HEALTH_CHECK}}
  } catch {
    database = 'down';
  }

  const healthy = database === 'up';
  const body = {
    status: healthy ? 'ok' : 'degraded',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    checks: { database },
  };

  return healthy ? success(res, body) : res.status(503).json({ success: false, data: body });
});

module.exports = router;
"""

HEALTH_VARIANTS = {
    "mongo": (
        "const { mongoose } = require('../config/database');",
        "    if (mongoose.connection.readyState !== 1) throw new Error('not connected');\n"
        "    await mongoose.connection.db.admin().ping();",
    ),
    "prisma": (
        "const { prisma } = require('../config/database');",
        "    await prisma.$queryRaw`SELECT 1`;",
    ),
}

SWAGGER = """const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const config = require('../config');

// Generated from route annotations rather than maintained by hand, so the docs
// cannot quietly drift away from the actual API.
const spec = swaggerJsdoc({
  definition: {
    openapi: '3.0.3',
    info: {
      title: '{{PROJECT_NAME}} API',
      version: '1.0.0',
      description: 'API documentation for {{PROJECT_NAME}}',
    },
    servers: [{ url: config.apiPrefix }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: ['./src/routes/*.js', './src/modules/**/*.routes.js'],
});

module.exports = function mountSwagger(app) {
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(spec));
  app.get('/docs.json', (_req, res) => res.json(spec));
};
"""

TESTS_SETUP = """// Test environment defaults. Set before any module reads config.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-not-used-in-production';
{{TEST_DB_ENV}}

jest.setTimeout(15000);
"""

TEST_UNIT = """const { NotFoundError, ConflictError } = require('../../src/errors/AppError');
const { ERROR_CODES } = require('../../src/constants/errorCodes');

describe('AppError', () => {
  it('carries a status, a code, and a client-safe message', () => {
    const err = new NotFoundError('User');
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe(ERROR_CODES.NOT_FOUND);
    expect(err.message).toBe('User not found');
  });

  it('marks deliberate errors as operational so the handler can safely surface them', () => {
    expect(new ConflictError().isOperational).toBe(true);
  });
});
"""

TEST_INTEGRATION = """const request = require('supertest');
const app = require('../../src/app');
const config = require('../../src/config');

describe('GET /health', () => {
  it('reports status and its dependency checks', async () => {
    const res = await request(app).get(`${config.apiPrefix}/health`);
    expect([200, 503]).toContain(res.status);
    expect(res.body.data).toHaveProperty('checks.database');
  });
});

describe('unknown routes', () => {
  it('returns a structured 404 rather than an HTML error page', async () => {
    const res = await request(app).get(`${config.apiPrefix}/definitely-not-a-route`);
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
"""

TEST_E2E = """const request = require('supertest');
const app = require('../../src/app');
const config = require('../../src/config');

const { connectDatabase, disconnectDatabase } = require('../../src/config/database');

/**
 * The journey that matters most: a new user registers, signs in, and reads their
 * own profile. If this passes, the auth wiring is sound end to end.
 *
 * Needs a real database, so it is opt-in rather than part of the default run:
 *
 *     RUN_E2E=1 npm run test:e2e
 *
 * Gating on an explicit flag rather than on a connection string keeps `npm test`
 * green on a fresh clone — a suite that fails before you have written any code
 * teaches people to ignore red, which is worse than having no suite.
 */
const maybe = process.env.RUN_E2E ? describe : describe.skip;

maybe('auth journey', () => {
  beforeAll(async () => {
    await connectDatabase();
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  const user = {
    name: 'Test User',
    email: `test_${Date.now()}@example.com`,
    password: 'Str0ngPassw0rd!',
  };
  let token;

  it('registers', async () => {
    const res = await request(app).post(`${config.apiPrefix}/auth/register`).send(user);
    expect(res.status).toBe(201);
    expect(res.body.data.user.email).toBe(user.email);
  });

  it('never returns the password hash', async () => {
    const res = await request(app).post(`${config.apiPrefix}/auth/login`).send({
      email: user.email,
      password: user.password,
    });
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('password');
    token = res.body.data.tokens.accessToken;
  });

  it('rejects a wrong password', async () => {
    const res = await request(app).post(`${config.apiPrefix}/auth/login`).send({
      email: user.email,
      password: 'wrong-password',
    });
    expect(res.status).toBe(401);
  });

  it('returns the profile for a valid token', async () => {
    const res = await request(app)
      .get(`${config.apiPrefix}/auth/me`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe(user.email);
  });

  it('refuses the profile without a token', async () => {
    const res = await request(app).get(`${config.apiPrefix}/auth/me`);
    expect(res.status).toBe(401);
  });
});
"""

FIXTURES = """/**
 * Factories, not fixed objects.
 *
 * Hand-built test objects scattered across twenty tests all need editing the day
 * a required field appears. A factory needs editing once.
 */
function buildUser(overrides = {}) {
  return {
    name: 'Test User',
    email: `user_${Math.random().toString(36).slice(2, 10)}@example.com`,
    password: 'Str0ngPassw0rd!',
    ...overrides,
  };
}

module.exports = { buildUser };
"""

SEED_SCRIPT = """require('dotenv').config();

const { connectDatabase, disconnectDatabase } = require('../src/config/database');
const logger = require('../src/utils/logger');

async function seed() {
  await connectDatabase();

  // Add development seed data here. Keep it idempotent — this script gets run
  // more than once, and it should be safe every time.
  logger.info('Nothing to seed yet');

  await disconnectDatabase();
}

seed().catch((err) => {
  logger.error('Seed failed', { error: err.message });
  process.exit(1);
});
"""

NGINX_CONF = """# Reverse proxy in front of the app.
# TLS, gzip, and static files are cheaper here than in Node, and offloading them
# keeps the event loop free for actual request handling.

upstream api {
    server api:3000;
    keepalive 32;
}

server {
    listen 80;
    server_name _;

    client_max_body_size 2m;

    # Do not advertise the version — free information for an attacker.
    server_tokens off;

    gzip on;
    gzip_types application/json text/plain text/css application/javascript;
    gzip_min_length 1024;

    location / {
        proxy_pass http://api;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }

    location /health {
        proxy_pass http://api/health;
        access_log off;
    }
}
"""
