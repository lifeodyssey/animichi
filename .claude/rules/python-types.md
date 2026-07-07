---
paths:
  - "apps/agent/**/*.py"
---
# Python type safety (apps/agent, auto-enforced)

Relocated from the root context file — scoped here so it only loads when editing Python.

- No `Any` — use `object` + `isinstance()` narrowing; `Protocol` for duck-typing; `cast()` only at
  library boundaries. Details: `docs/typing-rules.md`.
- No `dict[str, object]` — use a dataclass or a Pydantic model.
- No bare `str` for IDs / statuses — use `NewType`, `Literal`, or `Enum`.
- No `assert` for runtime validation — use `if not x: raise ValueError(...)`.
