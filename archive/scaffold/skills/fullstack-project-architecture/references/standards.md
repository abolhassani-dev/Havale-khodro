# Standards

Coding, security, testing, Docker, documentation, and Git conventions.

## Contents

- [Coding](#coding)
- [Security](#security)
- [Testing](#testing)
- [Docker](#docker)
- [Documentation](#documentation)
- [Git](#git)
- [Production readiness](#production-readiness)

## Coding

Follow SOLID, DRY, KISS, and YAGNI — with judgement. DRY applies to knowledge, not to
characters: two pieces of code that look alike but change for different reasons should stay
apart. Premature abstraction of coincidental similarity is harder to unpick than duplication.

YAGNI is the counterweight to everything else here. Build the structure so growth is possible;
do not build the growth.

Concretely:

- **Meaningful names.** `getUserById` over `get`. A name that needs a comment is the wrong name.
- **No unnecessary nesting.** Return early. Deep nesting is usually a missing function.
- **No duplicated business logic.** Once the same rule exists in two places, they will diverge.
- **Dependency injection where it buys testability** — pass the repository into the service
  rather than importing a singleton. Not everywhere; only where the seam is useful.
- **Functions do one thing.** If you need "and" to describe it, split it.
- **Comments explain why, not what.** The code says what.

## Security

Enabled by default in every project:

| Control | Implementation |
|---|---|
| Security headers | Helmet |
| Rate limiting | express-rate-limit, tighter on auth endpoints |
| Input validation | Joi or Zod in `validators/`, on every route |
| Sanitization | Strip or escape anything rendered or stored raw |
| Password hashing | bcrypt, cost 10+ |
| JWT | Short-lived access token, refresh token, rotation on use |
| Secrets | Environment only, validated at boot, never committed |
| CORS | Explicit allowlist, never `*` with credentials |
| Request size limits | Body size cap on every parser |
| Error masking | Client gets a code; details go to the log |
| Audit logging | Who did what, when, from where — for anything sensitive |

Beyond the checklist, two things matter more than the rest:

**Authorization is checked server-side on every request, per resource.** Hiding a button is
not access control. The most common real-world breach in an app like this is an endpoint that
checks *authentication* but forgets to check that this user owns *this* record.

**Never let sensitive data into a response the user is not entitled to.** Filtering in the UI
while the API returns the full object means anyone can read it from the browser's network
tab. Strip at the serialization boundary, not in the component.

Also: run `npm audit` in CI, keep dependencies current, run the process as a non-root user,
and never log secrets, tokens, or passwords.

## Testing

Generate all three levels, plus fixtures and factories:

- **Unit** — services and utils in isolation, repositories mocked. Fast, run constantly.
- **Integration** — routes against a real test database. Catches wiring and query errors that
  mocks hide.
- **E2E** — a few critical user journeys end to end. Registration, login, the core action.

Test behaviour, not implementation. A test asserting that a service called a specific
repository method breaks on every refactor while catching nothing.

Cover the paths that hurt: auth, permissions, money, and anything with a "must not" in its
description. A 90% coverage number that omits the authorization check is worse than an honest
60% that includes it.

Use factories for test data. Hand-built objects in twenty tests all need editing when a
required field appears.

## Docker

Generate a multi-stage `Dockerfile` — dependencies, build, then a slim runtime — plus a
`docker-compose.yml` with the app, database, and any needed services.

Include: a healthcheck, named volumes for data, an explicit network, non-root user, and
`.dockerignore`. Separate development (bind mount, hot reload) from production (built image,
no dev dependencies).

The container must not carry secrets. Configuration comes in through the environment at run
time.

## Documentation

Every project gets:

- **README** — what it is, prerequisites, install, run, test, environment variables, project
  layout, common commands.
- **Folder READMEs** — each folder states its responsibility and what does not belong in it.
  This is what keeps the structure intact when someone new adds a file at 2am.
- **API documentation** — Swagger, generated from route annotations so it cannot drift.
- **Environment guide** — every variable, what it does, whether it is required, and a safe
  example value.
- **Deployment guide** — how to build, run migrations, deploy, roll back.
- **Architecture overview** — the layers, the request flow, and why the boundaries exist.

Write the README as though the reader has just been handed the repository with no context —
because eventually that reader is the user, eighteen months later.

## Git

**`.gitignore`** covering `node_modules`, `.env`, build output, logs, coverage, and editor
files. Commit `.env.example`, never `.env`.

**Conventional Commits**: `type(scope): summary`

`feat` · `fix` · `refactor` · `perf` · `test` · `docs` · `build` · `ci` · `chore`

The value is machine-readable history: changelogs and version bumps derive from it.

**Branches**: `main` always deployable, `develop` for integration on larger projects, and
short-lived `feat/*` and `fix/*` branches. Short-lived is the operative word — long branches
mean painful merges.

**Versioning**: semver. Breaking changes are major, however small the diff.

**Release notes** grouped by change type, generated from commit history.

## Production readiness

Before a project is considered done:

- Health check endpoint that actually verifies dependencies, not just returning 200
- Structured JSON logging with request correlation ids
- Graceful shutdown draining in-flight requests
- `NODE_ENV=production` set explicitly
- Database indexes for the queries the app actually runs
- Connection pooling configured, not left at defaults
- Backups scheduled *and restore-tested* — an untested backup is not a backup
- A load test result recorded, so future slowdowns have a baseline to compare against
