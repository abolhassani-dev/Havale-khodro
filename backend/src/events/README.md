# events/

**Responsibility:** Domain events

Event definitions and listeners, decoupling side effects from the main flow.

**Does not belong here:** The main flow itself. Registration fires an event; it does not send the email.

---
_Part of the havale architecture standard. See `backend/README.md` for the full layout._
