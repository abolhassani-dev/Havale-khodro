# havale — backend

Node.js · Express · PostgreSQL + Prisma · server-side sessions · Docker

## Getting started

```bash
cp .env.example .env      # then fill in the secrets
npm install
```

Two databases: one to develop against, one for the e2e suite to create and delete rows in.

```bash
createdb havale_dev  &&  createdb havale_test        # as the `havale` role
npx prisma migrate dev
DATABASE_URL="postgresql://havale:havale@127.0.0.1:5432/havale_test" npx prisma migrate deploy
```

Then create the first administrator — there is no public registration, so nothing can sign
in until this runs. It prints a generated password once, and the account has to change it
on first sign-in.

```bash
npm run seed
npm run dev
```

API: `http://localhost:3000/api/v1` · Docs: `http://localhost:3000/docs` ·
Health: `http://localhost:3000/api/v1/health`

## Tests

Unit and integration tests need nothing. The e2e suite needs a database and is skipped
unless asked for, so a fresh clone is green before any of it is set up:

```bash
npm test                  # unit + integration; e2e skipped
RUN_E2E=1 npm test        # everything
```

## Authentication

Sessions are rows in the database, not JWTs. A signed token cannot be withdrawn before it
expires, and this system has to withdraw them: one live session per agent, immediate
suspension, and forced password change all depend on revoking a session on the spot.

The browser gets a random opaque token in an `httpOnly`, `SameSite=Strict` cookie; only its
SHA-256 hash is stored, so a database dump does not hand anyone a set of working sessions.
The token never appears in a response body — putting it there would invite the frontend to
keep it somewhere readable and undo `httpOnly`.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Development server with reload |
| `npm start` | Production server |
| `npm test` | All tests |
| `npm run test:coverage` | Coverage report |
| `npm run lint` | Lint |
| `npm run format` | Format |
| `npm run seed` | Seed development data |

## Docker

```bash
docker compose up --build
```

## Architecture

Requests flow in one direction, and each layer knows only about the one below it:

```
routes → middlewares → validators → controllers → services → repositories → models
```

- **Controllers** read the request and call one service. No business logic, no queries.
- **Services** hold the business rules and know nothing about HTTP, so they can also be
  called from a worker, a job, or a test.
- **Repositories** are the only code that talks to the database.

Every folder under `src/` has a README stating its responsibility and what does not belong
in it. When unsure where new code goes, read that README first.

Larger domains become modules under `src/modules/<name>/`, each with its own controller,
routes, service, repository, validator, and DTO. `modules/user/` is the reference example.

## Environment

See `.env.example`. The app validates required variables at boot and refuses to start if any
are missing — a missing secret should stop the process, not surface later as a confusing
runtime failure.

## Conventions

Conventional Commits (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`).
`main` stays deployable; work happens on short-lived `feat/*` and `fix/*` branches.
