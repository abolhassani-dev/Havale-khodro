# Changelog

Semantic versioning. Bump **major** when generated projects change shape in a way that
existing projects can't follow, **minor** for new capability, **patch** for fixes and wording.

## 1.0.0 — 2026-08-02

Initial standard.

- Layered backend: routes → middlewares → validators → controllers → services → repositories
- Feature-based frontend with slice isolation rules
- Scaffolder supporting MongoDB (Mongoose) and PostgreSQL / MySQL / SQLite (Prisma)
- Generated per project: config with boot-time env validation, Winston logging, typed errors,
  standard response builders, Helmet, CORS, compression, rate limiting with a tighter limit on
  auth, request ids, graceful shutdown, Swagger from route annotations, a health check that
  verifies the database, a complete auth module, a user module with real CRUD, multi-stage
  Dockerfile with healthcheck and non-root user, Compose, nginx config, ESLint, Prettier, Jest,
  and tests at all three levels
- A README for every folder stating its responsibility and what does not belong in it

Verified by generating both database variants, installing, linting, and running the suite —
including the full register/login/profile journey against a live PostgreSQL instance.
