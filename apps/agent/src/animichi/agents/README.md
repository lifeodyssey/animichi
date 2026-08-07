# agents/ — framework adapter (FastAPI / PydanticAI)

This package is the **framework adapter**: it owns the FastAPI/PydanticAI
runtime composition — the `pydantic_ai.Agent`, tools, memory capability,
typed outputs, and the model-turn runner — and nothing else.

Layering:

- `application/` owns **use cases** (`handle_user_message.HandleUserMessage`
  for one user-message turn). `agents/` wires them to the runtime.
- `domain/` owns framework-free domain logic and ports. Neither `domain/`
  nor `application/` may import FastAPI/PydanticAI (or the httpx adapter in
  `clients/`).

Turn lifecycle: `interfaces/` → `animichi_runner.run_animichi_agent` (this
adapter) → `HandleUserMessage` (application) → PydanticAI agent run (this
adapter, via the `TurnExecutor` port).
