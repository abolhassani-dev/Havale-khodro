# Stack Selection

Pick from context. Do not ask the user unless the choice is genuinely ambiguous *and*
expensive to reverse.

## Default stack

Unless overridden, use:

Node.js · Express · JavaScript · MongoDB with Mongoose · JWT · dotenv · Docker ·
Docker Compose · Nodemon · ESLint · Prettier · Jest · Morgan · Helmet · Compression ·
CORS · bcrypt · Swagger · Winston

This default exists so that projects start immediately instead of starting with a decision
meeting. Deviate when the domain clearly calls for it — see below — not out of preference.

## Database

| Signal in the request | Choose | Why |
|---|---|---|
| No strong signal either way | **MongoDB** + Mongoose | The default. Fast to start, flexible while the schema is still moving. |
| Money, invoices, orders, accounting, inventory | **PostgreSQL** + Prisma | Real transactions and constraints. Financial data with weak integrity guarantees is a liability. |
| Heavy relations, reporting, complex joins | **PostgreSQL** + Prisma | Joins and aggregates are what it is for. |
| Existing team or codebase already on MySQL | **MySQL** + Prisma | Match the environment; consistency beats marginal technical preference. |
| CLI tool, desktop app, prototype, single-user | **SQLite** + Drizzle or Prisma | No server to run or operate. |
| Documents with varying shape, logs, events | **MongoDB** | Schema variance is the normal case here, not a problem to work around. |

When in doubt between Mongo and Postgres, ask one question of the domain rather than of the
user: *does correctness across multiple records at once matter?* If yes — balances, stock
levels, seat counts, double-entry — choose Postgres.

## ORM

- **Mongoose** with MongoDB.
- **Prisma** with PostgreSQL or MySQL. Typed client, readable schema, sane migrations.
- **Drizzle** when the project wants SQL-first with light abstraction, or for SQLite.
- **TypeORM** only when an existing codebase already uses it.

## Language

JavaScript by default, per the user's standard.

Use TypeScript when the user asks, when the repository already uses it, or when the project
is a long-lived multi-developer system where type errors caught at build time pay for the
setup. Do not silently switch — mention it in the same line where you state your inferences.

## Adding infrastructure

Add these only when the project actually needs them; each is an operational cost, not just a
dependency.

| Need | Add |
|---|---|
| Sessions, rate limiting, cache, counters | Redis |
| Slow, retryable, or third-party-dependent work | BullMQ (needs Redis) |
| Realtime updates | Socket.IO |
| File uploads | Multer plus S3-compatible storage |
| Full-text search over user content | Postgres `pg_trgm`/`tsvector` first; a search engine only if that proves insufficient |
| Email | Nodemailer with a provider adapter |

Prefer the boring option that is already running over a new service. A Redis you already
operate beats a specialized system you do not.
