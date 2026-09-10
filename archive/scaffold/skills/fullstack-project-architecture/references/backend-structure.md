# Backend Structure

The canonical layout and, more importantly, the rule for deciding where a piece of code goes.

## Contents

- [The tree](#the-tree)
- [Request flow](#request-flow)
- [Folder responsibilities](#folder-responsibilities)
- [Deciding where code belongs](#deciding-where-code-belongs)
- [Module anatomy](#module-anatomy)

## The tree

```
backend/
├── src/
│   ├── config/          Configuration and environment loading
│   ├── controllers/     HTTP entry points (thin)
│   ├── middlewares/     Cross-cutting request concerns
│   ├── models/          ORM schema definitions
│   ├── routes/          URL → controller mapping, versioning
│   ├── services/        Business logic
│   ├── repositories/    Database access abstraction
│   ├── validators/      Request validation schemas
│   ├── utils/           Pure, dependency-free helpers
│   ├── constants/       Roles, statuses, enums, messages, error codes
│   ├── interfaces/      Contracts and shared abstractions
│   ├── types/           Shared types and DTOs
│   ├── errors/          Error classes and codes
│   ├── responses/       Standard response builders
│   ├── helpers/         Shared modules that need app context
│   ├── events/          Domain events and listeners
│   ├── jobs/            Cron and scheduled tasks
│   ├── queues/          Background job queues and workers
│   ├── cache/           Caching layer
│   ├── sockets/         Realtime handlers
│   ├── hooks/           Lifecycle hooks
│   ├── docs/            OpenAPI/Swagger definitions
│   ├── modules/         Self-contained business modules
│   └── app.js           Express app assembly
├── tests/{unit,integration,e2e,fixtures}
├── scripts/             Operational scripts (seed, migrate, backup)
├── docker/              Dockerfiles and container assets
├── nginx/               Reverse proxy configuration
└── server.js            Process entry point
```

## Request flow

The direction of dependency never reverses. Each layer knows only about the one below it.

```
HTTP request
  → routes/        picks the handler, applies middleware
  → middlewares/   auth, rate limit, validation trigger
  → validators/    rejects malformed input before it reaches logic
  → controllers/   extracts inputs, calls one service, formats the response
  → services/      business rules, orchestration, transactions
  → repositories/  the only layer that queries the database
  → models/        schema
```

Anything that skips a layer — a controller calling a repository, a service importing `res` —
is the thing that later makes the code impossible to test or reuse. That is why the boundaries
are worth defending even when skipping feels faster.

## Folder responsibilities

### config/
Application configuration, read from the environment exactly once at boot: database URLs,
JWT settings, Redis, mail, storage, feature flags, logging levels, external service
credentials. Validate required variables here and fail loudly at startup — a missing secret
should stop the process, not surface as a confusing runtime error under load.

Never read `process.env` anywhere else in the codebase. Scattered environment access makes it
impossible to know what a deployment actually requires.

### controllers/
Receive the request, call a service, return a response. Nothing else.

Does not belong here: business rules, database queries, external API calls, transaction
handling, validation logic.

### services/
Where the application actually decides things. Business rules, orchestration across
repositories, transactions, cache invalidation, queue dispatch, mail, notifications,
third-party integrations.

Services must be callable without HTTP. If a service references `req` or `res`, it cannot be
reused from a worker, a scheduled job, or a test — that is the signal it is doing a
controller's work.

### repositories/
Every database read and write. Query construction, joins, projections, pagination.

No business logic. A repository does not decide *whether* a user may be deleted; it deletes
the user. Keeping this line clean is what lets you change ORM or database without touching
business code.

### models/
Schema definitions, relations, indexes, and schema-level validation. Structure only —
behaviour lives in services.

Define indexes here deliberately. Index decisions made at schema time are cheap; discovering
a missing index under production load is not.

### validators/
Schema-based validation of every incoming request — body, params, query. Validation lives
here and nowhere else, because inline validation drifts between endpoints and diverges
silently over time.

Validate shape, type, length, range, and allowed values. Reject unknown fields rather than
ignoring them.

### middlewares/
Cross-cutting request concerns: authentication, authorization, permission checks, rate
limiting, security headers, CORS, compression, body parsing with size limits, request
logging, and the global error handler.

### routes/
URL structure, API versioning, route grouping, middleware attachment, and Swagger tags.
Routes map to controllers and hold no logic themselves.

Version from the first day (`/api/v1`). Retrofitting versioning after clients exist is
painful and avoidable.

### utils/
Small, pure, reusable functions with no application dependencies: date handling, string and
number formatting, encryption and hashing wrappers, the logger, formatters.

The test: a util should be movable to another project unchanged. If it needs config, a
model, or the database, it is a helper or a service, not a util.

### constants/
Roles, permissions, enums, statuses, message strings, error codes. Anything a magic string
would otherwise represent.

Magic strings are a correctness problem, not a style problem: a typo in `'aproved'` fails
silently and at runtime, while a missing constant fails immediately and visibly.

### interfaces/
Contracts and shared abstractions — what a repository or external adapter must implement.
Most useful in TypeScript projects and where dependency injection is in play.

### types/
Shared types and DTOs — the shapes crossing layer boundaries.

### errors/
Error classes and codes. `AppError` and its subclasses carry an HTTP status, a machine-
readable code, and a safe message. The global error handler formats them.

Internal detail never reaches the client. Stack traces and driver errors go to the log with
a correlation id; the client gets a code they can report.

### responses/
Builders that give every endpoint the same envelope — success, error, and paginated. Consumers
can then rely on the shape without anyone having to remember it per endpoint.

### helpers/
Shared modules that need application context — the middle ground between a pure util and a
full service. Use sparingly; a bloated `helpers/` usually means services are missing.

### events/
Domain events and their listeners, for decoupling side effects from the main flow. "User
registered" fires; the welcome-email listener reacts. The registration service should not
know that email exists.

### jobs/
Cron and scheduled tasks. Keep the schedule declaration separate from the work itself so the
work stays independently testable and re-runnable by hand.

Jobs must be idempotent. They will be run twice — after a restart, a deploy, or an overlap.

### queues/
Background job queues and their workers. Anything slow, retryable, or dependent on a flaky
third party belongs behind a queue rather than in the request path.

### cache/
The caching layer and its invalidation rules. Keep key construction in one place; scattered
key strings guarantee stale data eventually.

### sockets/
Realtime connection handling, rooms, and event handlers. Socket handlers call services like
controllers do — they are another transport, not another place for logic.

### hooks/
Lifecycle hooks: startup, graceful shutdown, connection handling.

Graceful shutdown matters in production — draining in-flight requests on deploy is the
difference between a clean release and dropped user requests.

### docs/
OpenAPI/Swagger definitions and generated API documentation.

### modules/
Self-contained business modules for larger domains. See below.

## Deciding where code belongs

Work down this list; the first match wins.

1. Does it talk to the database? → `repositories/`
2. Does it decide something about the business? → `services/`
3. Does it read the request or write the response? → `controllers/`
4. Does it apply to many routes regardless of domain? → `middlewares/`
5. Is it a pure function with no app dependencies? → `utils/`
6. Is it a fixed value with meaning? → `constants/`
7. Is it slow, retryable, or third-party dependent? → `queues/`
8. Does it run on a schedule? → `jobs/`
9. Is it a side effect that shouldn't block the main flow? → `events/`

If two answers seem to fit, the code is probably doing two things and should be split.

## Module anatomy

Once a domain grows past a handful of endpoints, move it into `src/modules/<name>/` so
everything about it lives together:

```
modules/user/
├── user.controller.js
├── user.routes.js
├── user.service.js
├── user.repository.js
├── user.validator.js
├── user.dto.js
├── user.model.js
└── user.test.js
```

The same layering rules apply inside a module — the module is an organizational boundary, not
an excuse to collapse layers.

Start a domain in the shared folders and promote it to a module when it has its own routes,
more than about three service methods, and its own vocabulary. Promoting early creates
ceremony; promoting late creates tangles.
