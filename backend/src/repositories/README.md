# repositories/

**Responsibility:** Database access

Every read and write. Query construction, joins, projections, pagination.

**Does not belong here:** Business logic. A repository deletes the user; it does not decide whether the user may be deleted.

---
_Part of the havale architecture standard. See `backend/README.md` for the full layout._
