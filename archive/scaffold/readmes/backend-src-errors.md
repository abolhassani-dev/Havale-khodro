# errors/

**Responsibility:** Error classes and codes

`AppError` and its subclasses, each carrying an HTTP status, a machine-readable code, and a client-safe message.

**Does not belong here:** Error handling itself — that is the global error middleware.

---
_Part of the havale architecture standard. See `backend/README.md` for the full layout._
