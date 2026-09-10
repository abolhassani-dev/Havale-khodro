# jobs/

**Responsibility:** Scheduled tasks

Cron definitions and the work they trigger.

**Does not belong here:** Non-idempotent work. Jobs will run twice — after a restart, a deploy, an overlap.

---
_Part of the havale architecture standard. See `backend/README.md` for the full layout._
