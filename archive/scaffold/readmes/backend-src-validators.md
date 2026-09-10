# validators/

**Responsibility:** Request validation

Schema validation of body, params, and query for every route.

**Does not belong here:** Nothing — but note that validation must not appear anywhere else. Inline validation drifts between endpoints and diverges silently.

---
_Part of the havale architecture standard. See `backend/README.md` for the full layout._
