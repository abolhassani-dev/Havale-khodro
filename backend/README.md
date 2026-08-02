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

## Contact masking

`src/modules/havale/havale.dto.js` is the only place a coordinator's phone number is
allowed into a response, and it only puts it there once the caller has proved the reveal
was recorded. Nothing else in the codebase should ever serialise it.

The reason is worth stating rather than assuming: if the API returned the number and the
interface merely hid it, anyone with a login and the browser's network tab could read every
number in the database — consuming none of the daily cap and leaving nothing in the audit
log. The interface runs on the viewer's machine and cannot be trusted to keep a secret.

`tests/e2e/havale.test.js` asserts this against the raw response payload rather than a
parsed field. If that test goes red, treat it as an incident, not a broken test.

## Car catalogue

Companies, brands, models and colours are rows, not free text — `CarCompany → CarBrand →
CarModel`, plus `CarColor`. As free text «فونیکس FX» and «فونیکس اف ایکس» are two different
cars that never find each other in a filter.

A listing stores both the model id *and* the model's name at the time it was posted.
Renaming a model therefore never rewrites what an old listing advertised, and deactivating
one stops new listings without breaking the ones already up. See `docs/car-catalog.md`.

## Subscriptions and module mode

An account's entitlement is answered in one place, `subscription.service.resolveAccess()`.
Every rule in the access table reduces to that question, and scattering
`if (expiresAt > now)` across controllers is how a system ends up allowing through one
endpoint what it blocks on another.

Two rules there are worth knowing before changing anything:

- **A sub-agency's expiry is never stored.** It is read from the parent every time, so the
  parent renewing restores all of them at once and the two can never disagree. The date on
  the seat's own row is a placeholder the resolver does not read.
- **Capacity is prepaid, and suspending mid-period does not release a seat.** Otherwise a
  reseller could suspend everyone on the last day of the month, reactivate on the first, and
  never pay for capacity at all. `countSeatsUsed` therefore counts accounts suspended inside
  the current period as still occupying their seat.

Prices and caps that a business decision might revise live in `settings.service` — the seat
price, the SMS switch, the reporting cap. The rule of thumb is whether changing it is a
business decision or an engineering one.

## Violation reports

Reports cut both ways on purpose. A system that only punishes the accused becomes a weapon:
report every competitor three times and they are suspended. So a verdict can land on either
party — `CONFIRMED` strikes the advertiser, `ABUSIVE` strikes the reporter — and both sides
accumulate strikes toward the same threshold.

The third strike suspends an account, and support staff do not hold that authority. When a
verdict would be somebody's third, it is recorded and queued for the super admin instead of
taking effect. Support can still do their job; they just cannot end an agency's month on
their own.

Everything refused when filing a report closes a specific hole: one report per agency per
listing (three colleagues could otherwise manufacture a suspension), a daily cap, a
mandatory explanation long enough to investigate, and — for "nobody answers" — proof in the
reveal log that the reporter actually called. Reports stay open for thirty days after a
listing closes, deleted listings included, so deleting is not an escape route.

## SMS

There is no SMS panel yet, so delivery is switched off — but the whole path is built and
tested. With the switch off, every message is still rendered and written to the `SmsMessage`
outbox; only the final hand-off to a provider is skipped. That means the notification
behaviour can be demonstrated now, and buying a panel later is a setting plus two
environment variables rather than a development task.

- Drivers live in `src/modules/sms/drivers/`. Adding a provider is one file and one line in
  `drivers/index.js`; nothing outside that folder knows which provider is in use.
- The switch is the stored setting `sms.enabled`, not an environment variable, so it can be
  flipped from the admin panel without a deploy. `SMS_ENABLED` is only the initial default.
- `smsService.send()` never throws for a delivery problem. A user must not be unable to
  sign in because a gateway is down.

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
