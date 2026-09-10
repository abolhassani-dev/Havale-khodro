---
name: fullstack-project-architecture
description: The user's permanent, personal architecture standard for any new backend, frontend, or fullstack project. Use this skill whenever the user starts a new project or adds a new service — "create a new project", "start a new backend", "scaffold an API", "set up a new app", "build me a REST API", "new microservice", "بزن یه پروژه جدید" — and also when adding a substantial new module, service, or feature folder to an existing project, so it lands in the right layer. Apply it automatically without asking permission or asking clarifying questions; the standard is already decided. Layered architecture (controller → service → repository), feature modules, production-ready from commit one — Docker, Swagger, structured logging, validation, security middleware, error handling, and tests all generated up front.
---

# Fullstack Project Architecture

This is the user's standing development standard. They have already made these decisions
and do not want to re-litigate them per project. Apply the architecture, then get on with
the actual domain work.

## Core principle

**Do not ask what architecture to use. Scaffold it, then build the domain on top.**

The user's stated intent: "Whenever I say *create a new project*, generate a production-ready
architecture automatically. Do NOT ask unnecessary questions."

Ask only when something is genuinely undecidable from context — a domain rule you cannot
infer, or an explicit conflict with this standard. Stack choice, folder layout, and tooling
are not those things.

## Workflow

### 1. Infer, don't interrogate

From the user's request, silently determine:

| Question | How to decide |
|---|---|
| Backend, frontend, or both? | If they mention UI, pages, dashboard, or a user-facing app → both. API/service/bot/webhook only → backend. |
| Project name | From their description. Kebab-case. Don't ask. |
| Database | See `references/stack-selection.md`. Default MongoDB; switch when the domain is clearly relational. |
| TypeScript or JavaScript | Default JavaScript. Use TypeScript if they say so, or if the repo already uses it. |

State your inferences in one line as you start ("Scaffolding a Node/Express/MongoDB backend
called `x` — say the word if you want Postgres instead"). That gives them a cheap correction
point without a question-and-answer round trip.

### 2. Run the scaffolder

```bash
python3 ~/.claude/skills/fullstack-project-architecture/scripts/scaffold.py <target-dir> \
  --name <project-name> \
  --db <mongo|postgres|mysql|sqlite> \
  --frontend            # only when a UI is needed
  --typescript          # only when TS is requested
```

It generates the full tree, every folder's README, and working boilerplate: config loader,
logger, error handling, response builders, security middleware, rate limiting, Swagger,
health check, a complete auth module, a user module with real CRUD, Docker, Compose, ESLint,
Prettier, Jest, and example tests at all three levels.

The scaffolder is deterministic and fast. Do not hand-write this structure — running the
script is both quicker and consistent across projects, which is the whole point of having a
standard.

### 3. Verify it runs before building on it

```bash
cd <target-dir>/backend && npm install && npm test
```

A scaffold that doesn't boot is worse than no scaffold, because the user discovers it three
hours later mixed in with their own code.

### 4. Build the domain into the structure

Now write the actual application. Every new business capability becomes a **module** under
`src/modules/<name>/` containing its own controller, routes, service, repository, validator,
DTO, and tests. The generated `user` module is the reference implementation — follow its shape.

Read `references/backend-structure.md` when deciding where a given piece of code belongs.
That file is the arbiter for "does this go in a service or a helper" questions.

## Non-negotiables

These exist because violating them is what turns a clean project into an unmaintainable one,
and it always happens gradually.

**Controllers never contain business logic or database calls.** A controller reads the
request, calls one service method, and shapes the response. The moment a controller queries
the database directly, that logic becomes untestable and unreusable — and the next developer
copies the pattern.

**Services never touch the HTTP layer.** No `req`, no `res`, no status codes. A service that
knows about HTTP cannot be called from a queue worker, a cron job, or a test.

**Repositories are the only place that talks to the ORM.** This is what makes swapping
MongoDB for Postgres a contained change rather than a rewrite.

**Validation happens in `validators/`, never inline in a controller.** Inline validation
drifts between endpoints and silently diverges.

**No hardcoded secrets, no magic strings.** Config comes from `config/`, which reads the
environment and fails loudly at boot if something required is missing. Strings that carry
meaning — roles, statuses, error codes — live in `constants/`.

**Errors are typed and centralized.** Throw `AppError` subclasses; the global error handler
formats them. Never send a raw exception to a client — it leaks internals.

**Every response goes through the response builders** in `responses/`, so the API shape stays
consistent without anyone having to remember it.

## Scope discipline

Generate a folder only when it has a job in this project. The user's standard lists many
folders — `sockets/`, `queues/`, `events/` — and the scaffolder creates them with a README
explaining their purpose, but **do not populate them with placeholder code for features that
don't exist**. An empty documented folder is a signpost; a folder full of unused boilerplate
is debt.

Equally: don't skip a folder because the project "is small right now". The point of the
standard is that growth doesn't require restructuring.

## When the user overrides

If they ask for something different — a different framework, a flatter structure, no Docker —
follow their instruction for that project without argument or repeated warnings. State the
tradeoff once if it is significant, then do as asked. This is their standard; they are allowed
to depart from it.

## Reference files

Read these as needed rather than up front:

- `references/backend-structure.md` — every folder's responsibility and what does *not* belong
  in it. Consult when placing new code.
- `references/frontend-structure.md` — feature-based frontend layout and its rules.
- `references/stack-selection.md` — how to pick the database, ORM, and language for a project.
- `references/standards.md` — coding, security, testing, Docker, documentation, and Git
  conventions in detail. Consult before setting up CI, writing tests, or hardening for
  production.
