# services/

**Responsibility:** Business logic

Business rules, orchestration across repositories, transactions, cache invalidation, queue dispatch, mail, notifications, third-party integrations.

**Does not belong here:** Anything HTTP. No `req`, no `res`, no status codes — a service that knows about HTTP cannot be called from a worker, a job, or a test.

---
_Part of the havale architecture standard. See `backend/README.md` for the full layout._
