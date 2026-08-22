# middlewares/

**Responsibility:** Cross-cutting request concerns

Authentication, authorization, permissions, rate limiting, security headers, CORS, body parsing, request logging, global error handling. (Compression is nginx's, not this process's — see src/app.js.)

**Does not belong here:** Domain-specific logic. If it only applies to one resource, it belongs in that module.

---
_Part of the havale architecture standard. See `backend/README.md` for the full layout._
