#!/usr/bin/env python3
"""Scaffold a project following the fullstack-project-architecture standard.

Usage:
    python3 scaffold.py <target-dir> --name my-app [--db mongo] [--frontend]

Generates the full folder tree, a README for every folder explaining its
responsibility, and working boilerplate: config, logging, error handling,
response builders, security middleware, rate limiting, Swagger, a health check,
a complete auth module, a user module with real CRUD, Docker, and tests.

Idempotent: existing files are left alone unless --force is passed.
"""

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import templates as T
import templates_modules as M

BACKEND_SRC_DIRS = list(T.BACKEND_FOLDERS.keys())
TEST_DIRS = ["unit", "integration", "e2e", "fixtures"]

PRISMA_DBS = {"postgres", "mysql", "sqlite"}
PRISMA_PROVIDER = {"postgres": "postgresql", "mysql": "mysql", "sqlite": "sqlite"}


class Scaffolder:
    def __init__(self, root: Path, name: str, db: str, force: bool):
        self.root = root
        self.name = name
        self.db = db
        self.force = force
        self.uses_prisma = db in PRISMA_DBS
        self.written = 0
        self.skipped = 0

    # ---------------------------------------------------------------- helpers

    def render(self, text: str) -> str:
        return text.replace("{{PROJECT_NAME}}", self.name)

    def write(self, rel_path: str, content: str) -> None:
        path = self.root / rel_path
        path.parent.mkdir(parents=True, exist_ok=True)

        if path.exists() and not self.force:
            self.skipped += 1
            return

        path.write_text(self.render(content), encoding="utf-8")
        self.written += 1

    def folder_readme(self, base: str, folders: dict) -> None:
        for folder, (responsibility, detail, excluded) in folders.items():
            body = T.FOLDER_README.format(
                name=folder,
                responsibility=responsibility,
                detail=detail,
                excluded=excluded,
            )
            self.write(f"{base}/{folder}/README.md", body)

    # ---------------------------------------------------------------- backend

    def backend(self) -> None:
        self.folder_readme("backend/src", T.BACKEND_FOLDERS)

        for d in TEST_DIRS:
            (self.root / "backend/tests" / d).mkdir(parents=True, exist_ok=True)
        for d in ("scripts", "docker", "nginx"):
            (self.root / "backend" / d).mkdir(parents=True, exist_ok=True)

        self._root_files()
        self._core_src()
        self._modules()
        self._tests()

    def _root_files(self) -> None:
        db_env = T.DB_ENV[self.db].replace("{{PROJECT_NAME}}", self.name)
        self.write("backend/.env.example", T.ENV_EXAMPLE.replace("{{DB_ENV}}", db_env))
        self.write("backend/.gitignore", T.GITIGNORE)
        self.write("backend/.dockerignore", T.DOCKERIGNORE)
        self.write("backend/.eslintrc.json", T.ESLINTRC)
        self.write("backend/.prettierrc", T.PRETTIERRC)
        self.write("backend/jest.config.js", T.JEST_CONFIG)
        self.write("backend/Dockerfile", T.DOCKERFILE)
        self.write("backend/nginx/default.conf", T.NGINX_CONF)
        self.write("backend/scripts/seed.js", T.SEED_SCRIPT)

        self.write(
            "backend/package.json",
            T.PACKAGE_JSON
            .replace("{{EXTRA_DEPS}}", T.EXTRA_DEPS[self.db])
            .replace("{{EXTRA_DEV_DEPS}}", T.EXTRA_DEV_DEPS[self.db]),
        )
        self.write(
            "backend/docker-compose.yml",
            T.COMPOSE.replace("{{DB_SERVICE}}", T.DB_SERVICE[self.db]),
        )
        self.write("backend/server.js", T.SERVER_JS)
        self.write("backend/README.md", self._backend_readme())

    def _core_src(self) -> None:
        s = "backend/src"

        required_db = "" if self.db == "sqlite" else (
            ", 'MONGO_URI'" if self.db == "mongo" else ", 'DATABASE_URL'"
        )
        config_index = (
            T.CONFIG_INDEX
            .replace("{{REQUIRED_DB_ENV}}", required_db)
            .replace("{{DB_CONFIG}}", T.DB_CONFIG_BLOCK[self.db])
        )
        self.write(f"{s}/config/index.js", config_index)
        self.write(
            f"{s}/config/database.js",
            T.DATABASE_PRISMA if self.uses_prisma else T.DATABASE_MONGO,
        )

        self.write(f"{s}/app.js", T.APP_JS)
        self.write(f"{s}/utils/logger.js", T.LOGGER)
        self.write(f"{s}/utils/asyncHandler.js", T.ASYNC_HANDLER)
        self.write(f"{s}/errors/AppError.js", T.APP_ERROR)
        self.write(f"{s}/constants/errorCodes.js", T.ERROR_CODES)
        self.write(f"{s}/constants/roles.js", T.ROLES)
        self.write(f"{s}/constants/messages.js", T.MESSAGES)
        self.write(f"{s}/responses/apiResponse.js", T.API_RESPONSE)
        self.write(f"{s}/middlewares/errorHandler.js", T.ERROR_HANDLER)
        self.write(f"{s}/middlewares/notFound.js", T.NOT_FOUND)
        self.write(f"{s}/middlewares/requestId.js", T.REQUEST_ID)
        self.write(f"{s}/middlewares/rateLimiter.js", T.RATE_LIMITER)
        self.write(f"{s}/middlewares/auth.js", T.AUTH_MIDDLEWARE)
        self.write(f"{s}/middlewares/validate.js", T.VALIDATE_MIDDLEWARE)
        self.write(f"{s}/hooks/shutdown.js", T.SHUTDOWN_HOOK)
        self.write(f"{s}/routes/index.js", T.ROUTES_INDEX)
        self.write(f"{s}/docs/swagger.js", T.SWAGGER)

        variant = "prisma" if self.uses_prisma else "mongo"
        health_import, health_check = T.HEALTH_VARIANTS[variant]
        self.write(
            f"{s}/routes/health.routes.js",
            T.HEALTH_ROUTES
            .replace("{{HEALTH_IMPORT}}", health_import)
            .replace("{{HEALTH_CHECK}}", health_check),
        )

    def _modules(self) -> None:
        m = "backend/src/modules"

        self.write(f"{m}/user/user.repository.js",
                   M.USER_REPOSITORY_PRISMA if self.uses_prisma else M.USER_REPOSITORY_MONGO)
        self.write(f"{m}/user/user.service.js", M.USER_SERVICE)
        self.write(f"{m}/user/user.controller.js", M.USER_CONTROLLER)
        self.write(f"{m}/user/user.validator.js", M.USER_VALIDATOR)
        self.write(f"{m}/user/user.routes.js", M.USER_ROUTES)
        self.write(f"{m}/user/user.dto.js", M.USER_DTO)

        if self.uses_prisma:
            self.write(
                "backend/prisma/schema.prisma",
                M.PRISMA_SCHEMA.replace("{{PRISMA_PROVIDER}}", PRISMA_PROVIDER[self.db]),
            )
        else:
            self.write(f"{m}/user/user.model.js", M.USER_MODEL_MONGO)

        self.write(f"{m}/auth/auth.service.js", M.AUTH_SERVICE)
        self.write(f"{m}/auth/auth.controller.js", M.AUTH_CONTROLLER)
        self.write(f"{m}/auth/auth.validator.js", M.AUTH_VALIDATOR)
        self.write(f"{m}/auth/auth.routes.js", M.AUTH_ROUTES)

    def _tests(self) -> None:
        t = "backend/tests"

        test_db_env = {
            "mongo": "process.env.MONGO_URI = process.env.MONGO_URI || "
                     "'mongodb://localhost:27017/{{PROJECT_NAME}}_test';",
            "postgres": "process.env.DATABASE_URL = process.env.DATABASE_URL || "
                        "'postgresql://postgres:postgres@localhost:5432/{{PROJECT_NAME}}_test';",
            "mysql": "process.env.DATABASE_URL = process.env.DATABASE_URL || "
                     "'mysql://root:root@localhost:3306/{{PROJECT_NAME}}_test';",
            "sqlite": "process.env.DATABASE_URL = process.env.DATABASE_URL || 'file:./test.db';",
        }[self.db]

        self.write(f"{t}/setup.js", T.TESTS_SETUP.replace("{{TEST_DB_ENV}}", test_db_env))
        self.write(f"{t}/unit/appError.test.js", T.TEST_UNIT)
        self.write(f"{t}/unit/user.service.test.js", M.USER_TEST)
        self.write(f"{t}/integration/health.test.js", T.TEST_INTEGRATION)
        self.write(f"{t}/e2e/auth.test.js", T.TEST_E2E)
        self.write(f"{t}/fixtures/user.factory.js", T.FIXTURES)

    # --------------------------------------------------------------- frontend

    def frontend(self) -> None:
        self.folder_readme("frontend/src", T.FRONTEND_FOLDERS)
        (self.root / "frontend/src/features").mkdir(parents=True, exist_ok=True)
        self.write("frontend/README.md", self._frontend_readme())
        self.write("frontend/.gitignore", T.GITIGNORE)

    # ---------------------------------------------------------------- readmes

    def _backend_readme(self) -> str:
        db_label = {
            "mongo": "MongoDB + Mongoose",
            "postgres": "PostgreSQL + Prisma",
            "mysql": "MySQL + Prisma",
            "sqlite": "SQLite + Prisma",
        }[self.db]

        prisma_note = (
            "\n### Database schema\n\n"
            "```bash\nnpx prisma migrate dev --name init\nnpx prisma generate\n```\n"
            if self.uses_prisma else ""
        )

        return f"""# {{{{PROJECT_NAME}}}} — backend

Node.js · Express · {db_label} · JWT · Docker

## Getting started

```bash
cp .env.example .env      # then fill in the secrets
npm install
npm run dev
```
{prisma_note}
API: `http://localhost:3000/api/v1` · Docs: `http://localhost:3000/docs` ·
Health: `http://localhost:3000/api/v1/health`

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
"""

    def _frontend_readme(self) -> str:
        return """# {{PROJECT_NAME}} — frontend

Feature-based architecture: code that changes together lives together.

## Layout

- `features/` — self-contained domains, each exporting through its `index.js`
- `components/` — shared presentational components, no business logic
- `pages/` — thin route entry points composing a layout and a feature
- `api/` — the single HTTP client, interceptors, and error normalization
- `store/` — global client state only; server data belongs in a data-fetching layer

## Rules

Features import from other features only through the public `index.js`, and ideally not at
all — anything two features need belongs in the shared layer. Deep imports harden into
coupling that makes a feature impossible to move or delete.

Every folder under `src/` has a README describing its responsibility.
"""

    # ------------------------------------------------------------------- main

    def run(self, with_frontend: bool) -> None:
        self.backend()
        if with_frontend:
            self.frontend()

        self.write(".gitignore", T.GITIGNORE)
        self.write(
            "README.md",
            f"""# {{{{PROJECT_NAME}}}}

{"Backend and frontend" if with_frontend else "Backend"} for {{{{PROJECT_NAME}}}}.

- `backend/` — API. See `backend/README.md`.
"""
            + ("- `frontend/` — UI. See `frontend/README.md`.\n" if with_frontend else "")
            + """
Generated from the `fullstack-project-architecture` standard.
""",
        )


def main() -> int:
    parser = argparse.ArgumentParser(description="Scaffold a project to the architecture standard")
    parser.add_argument("target", help="Directory to create the project in")
    parser.add_argument("--name", required=True, help="Project name (kebab-case)")
    parser.add_argument(
        "--db",
        default="mongo",
        choices=["mongo", "postgres", "mysql", "sqlite"],
        help="Database (default: mongo)",
    )
    parser.add_argument("--frontend", action="store_true", help="Also scaffold a frontend")
    parser.add_argument("--force", action="store_true", help="Overwrite existing files")
    args = parser.parse_args()

    root = Path(args.target).expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True)

    s = Scaffolder(root, args.name, args.db, args.force)
    s.run(args.frontend)

    print(f"Scaffolded '{args.name}' in {root}")
    print(f"  {s.written} files written, {s.skipped} left alone (already existed)")
    print(f"  Database: {args.db}" + ("  ·  frontend included" if args.frontend else ""))
    print()
    print("Next:")
    print(f"  cd {root}/backend && cp .env.example .env && npm install && npm test")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
