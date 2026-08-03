# Vercel AI SDK v6 Data Stream Protocol Migration — Implementation Cards

## Iteration Config
- executor_model: sonnet (via claude code worktree)
- reviewer_model: claude (via coderabbit) + code-reviewer agent
- tester_model: claude-opus-4-6 (via qa skill)
- pinned_at: 2026-05-07T21:00:00+08:00

## Wave Graph

```
Wave 1 (parallel):  [Card 1: Backend endpoint]  [Card 2: Frontend deps + adapter]
                           ↓                            ↓
Wave 2 (parallel):  [Card 3: Integration wiring]
                           ↓
Wave 3 (sequential): [Card 4: E2E validation + cleanup]
```

No file overlap between Card 1 and Card 2 — they can execute in parallel.
Card 3 depends on both Card 1 and Card 2.
Card 4 depends on Card 3.

---

## Card 1: Backend — New `/v1/chat` endpoint with VercelAIAdapter

- **Scope:** Add new streaming endpoint using PydanticAI's native VercelAIAdapter
- **Files changed:**
  - `backend/interfaces/routes/chat.py` (create)
  - `backend/interfaces/schemas.py` (modify — add ChatRequest model)
  - `backend/interfaces/fastapi_service.py` (modify — register chat_router)
  - `backend/tests/unit/test_chat_endpoint.py` (create)
  - `backend/tests/unit/test_chat_schemas.py` (create)
- **AC:**
  - [ ] `POST /v1/chat` returns `Content-Type: text/event-stream` with valid Vercel Data Stream Protocol SSE → unit
  - [ ] Tool calls (resolve_anime, search_bangumi) produce `tool-input-start` + `tool-output-available` events → integration
  - [ ] `on_complete` callback injects `DataChunk(type="data-seichijunrei-metadata")` with session_id, intent, route_history, ui → unit
  - [ ] Auth header (Bearer JWT) is validated same as `/v1/runtime/stream` → unit
  - [ ] Old `/v1/runtime/stream` endpoint continues working unchanged → unit
  - [ ] `selected_point_ids` requests still use old `/v1/runtime` endpoint (not routed to /v1/chat) → unit
- **Dependencies:** None
- **Wave:** 1
- **Branch:** iter10/backend-vercel-chat
- **Review mode:** full

---

## Card 2: Frontend — Install Vercel AI SDK + adapter hook

- **Scope:** Add `ai` + `@ai-sdk/react` v6 packages, create adapter utilities and hook
- **Files changed:**
  - `frontend/package.json` (modify — add ai, @ai-sdk/react)
  - `frontend/package-lock.json` (modify — lockfile)
  - `frontend/lib/api/vercel-adapter.ts` (create — message.parts → ChatMessage mapping)
  - `frontend/hooks/useVercelChat.ts` (create — wraps Vercel useChat, returns same interface)
  - `frontend/tests/vercel-adapter.test.ts` (create)
  - `frontend/tests/useVercelChat.test.tsx` (create)
- **AC:**
  - [ ] `vercelMessageToChatMessage()` maps Vercel text parts → `ChatMessage.text` → unit
  - [ ] `vercelMessageToChatMessage()` maps tool parts → `ChatMessage.steps[]` → unit
  - [ ] `vercelMessageToChatMessage()` maps `data-seichijunrei-metadata` DataChunk → `ChatMessage.response` → unit
  - [ ] `useVercelChat` returns `{ messages, send, sending, clear }` matching existing `useChat` interface → unit
  - [ ] `useVercelChat` passes `session_id` and `locale` in request body → unit
  - [ ] `useVercelChat` passes auth headers via `getAuthHeaders()` → unit
  - [ ] Existing `useChat` hook and `sendMessageStream` are NOT modified → unit
- **Dependencies:** None
- **Wave:** 1
- **Branch:** iter10/frontend-vercel-adapter
- **Review mode:** full

---

## Card 3: Integration wiring — Feature flag + AppShell switch

- **Scope:** Connect frontend adapter to backend endpoint via feature flag
- **Files changed:**
  - `frontend/components/layout/AppShell.tsx` (modify — feature flag switch between useChat / useVercelChat)
  - `frontend/lib/env.ts` or inline (create/modify — `NEXT_PUBLIC_USE_VERCEL_CHAT` flag)
  - `frontend/tests/appshell-layout.test.tsx` (modify — test both paths)
- **AC:**
  - [ ] `NEXT_PUBLIC_USE_VERCEL_CHAT=false` (default): AppShell uses existing `useChat` hook → unit
  - [ ] `NEXT_PUBLIC_USE_VERCEL_CHAT=true`: AppShell uses `useVercelChat` hook → unit
  - [ ] With flag on: sending a message hits `/v1/chat` endpoint → integration
  - [ ] With flag on: tool call progress visible in ThinkingProcess component → browser
  - [ ] With flag on: search results render in ResultPanel after completion → browser
  - [ ] With flag on: session_id round-trips correctly (multi-turn conversation) → integration
  - [ ] With flag off: all existing functionality works unchanged → unit
- **Dependencies:** Card 1, Card 2
- **Wave:** 2
- **Branch:** iter10/integration-feature-flag
- **Review mode:** full

---

## Card 4: E2E validation + cleanup

- **Scope:** Validate all 7 intent scenarios end-to-end, make Vercel chat default, clean up dead code markers
- **Files changed:**
  - `frontend/components/layout/AppShell.tsx` (modify — remove feature flag, Vercel is default)
  - `e2e/chat-vercel.spec.ts` (create — E2E tests for new protocol)
  - `docs/ARCHITECTURE.md` (modify — document new streaming protocol)
- **AC:**
  - [ ] search_bangumi flow: user types anime → PilgrimageGrid renders with results → browser
  - [ ] search_nearby flow: user asks nearby → NearbyBubble renders → browser
  - [ ] plan_route flow: user asks route → RoutePlannerWizard renders → browser
  - [ ] greet_user flow: text response only, no result panel → browser
  - [ ] clarify flow: disambiguation options shown → browser
  - [ ] error handling: backend error → error message in chat → browser
  - [ ] session continuity: multi-turn conversation preserves context → browser
  - [ ] Feature flag removed, Vercel chat is default → unit
  - [ ] ARCHITECTURE.md updated with new streaming protocol → docs
- **Dependencies:** Card 3
- **Wave:** 3
- **Branch:** iter10/e2e-validation
- **Review mode:** full

---

## Summary

| Wave | Cards | Parallel? | Estimated Scope |
|------|-------|-----------|-----------------|
| 1 | Card 1 (backend), Card 2 (frontend) | Yes | Medium each |
| 2 | Card 3 (integration) | Solo | Medium |
| 3 | Card 4 (E2E + cleanup) | Solo | Light-medium |

**Total: 4 cards, 3 waves.** Wave 1 is the bulk of the work. Wave 2 wires it together. Wave 3 validates and cleans up.

**NOT in scope (deferred to design overhaul State 2-10):**
- UI component changes (ThinkingProcess, ResultPanel, etc.)
- Generative UI component rendering (tool→component skeleton/loading states)
- Removing old `sendMessageStream` / custom `useChat` (Phase 4 in spec — separate iteration)
