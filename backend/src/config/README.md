# config/

**Responsibility:** Configuration and environment loading

Reads the environment once at boot and validates it. Database, JWT, Redis, mail, storage, feature flags, logging, external services.

**Does not belong here:** Reading `process.env` anywhere else in the codebase. Scattered environment access makes it impossible to know what a deployment requires.

---
_Part of the havale architecture standard. See `backend/README.md` for the full layout._
