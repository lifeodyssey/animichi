# packages/contract — AGENTS.md

Shared oRPC/Zod contract and single source of truth for catalog/users wire types. The catalog
Worker and Python agent keep deliberate hand-mirrors where bundling or sentinel defaults require
them. Root guide: `../../AGENTS.md`; detailed mirror checklist: `README.md`.

## Commands (from `packages/contract/`)

- `pnpm run typecheck` — TypeScript 7.0.2 `tsc --noEmit`.
- `pnpm run emit:openapi` — regenerate `openapi.json`, `users-openapi.json`, and `agent-openapi.json`.
- `pnpm run emit:tool-schemas` — regenerate `src/agent-tool-schemas.ts` from
  `src/agent-tool-parameters.ts`. This is the repo's **single** zod↔JSON-Schema conversion
  (agent TS rewrite spec §二, "schema 边界"): the agent's four catalog tool parameter schemas, the
  two web tools' (`web_search`, `translate_anime_title`, #1287) and the `respond` answer tool's are
  declared here in zod — the catalog ones composed from the catalog's own request constraints, the
  web ones composing nothing because there is no second declaration for them to agree with — and
  `workers/edge` consumes the generated module without loading zod. The module
  also carries `ANSWER_TOOL_NAME` and `CHAT_RESPONSE_INTENTS` (read off `ChatResponseDataPart`'s
  own union, #1283) for the same reason — the Worker names the tool and builds the part but cannot
  load zod to learn either vocabulary. `test/agent-tool-schemas.test.ts` fails on committed drift,
  the way the OpenAPI documents do; `test/chat-answer-part.test.ts` parses what the edge's
  projection actually emits. Never hand-edit the generated file.
- `pnpm run vet:openapi <baseline.json> <candidate.json>` — OpenAPI compat gate
  (issue #1005 AC4/AC5): fails on unapproved breaking changes, approves additive
  ones, and rejects a future major path unless its superseded operation carries
  `deprecated: true` + `x-sunset`. `--allow-breaking` is the explicit approval
  flag — never pass it in the normal CI gate.

OpenAPI emission is byte-stable: JSON is pretty-printed with one trailing newline. Regenerate on
every contract change and commit all three outputs. CI reruns emission and fails on committed drift,
then runs `vet:openapi` for each document against the merge-base baseline (the published contract)
in the `Contract / build` stage — unapproved breaking `/v1` changes fail closed there. Baseline
bootstrap (#1005 AC3): a merge-base baseline still carrying the retired phantom check-in/share
surface is replaced by the post-cut documents committed in this tree — that fallback can only fire
on this landing, because after it lands merge-base IS the post-cut contract.

## Conventions

- Zod schemas and oRPC contracts live in `src/`; export public types through `src/index.ts`.
- `zod@4.4.3` and `@orpc/*@1.14.10` are one coupled exact-pin set across this package,
  `workers/catalog`, `workers/users`, and `apps/web`. Change them together.
- Catalog internals use type-only hand-mirrors so Zod stays out of the Worker bundle; Python models
  remain hand-written because their sentinel defaults intentionally differ.
- Semantic contract freeze is the red line: do not change wire meaning without an approved story.
  Formatting churn is acceptable only when the OpenAPI drift check stays green.

## Key files + entrypoints

- `src/models.ts` — shared Zod data models.
- `src/agent-tool-parameters.ts` — the agent's catalog tool parameters, the two web tools' and the
  `respond` answer tool's, in zod (not a wire type: no oRPC procedure and no OpenAPI document references them) ·
  `src/agent-tool-schemas.ts` — their generated JSON Schema · `scripts/emit-tool-schemas.ts` — the
  conversion · `test/agent-tool-schemas.test.ts` — its drift gate ·
  `test/chat-answer-part.test.ts` — the conformance gate on the edge's `data-response` projection.
- `src/contract.ts` — catalog procedures and error attachments.
- `src/users-contract.ts` — users-service procedures and errors.
- `src/errors.ts` — canonical catalog error registry.
- `scripts/emit-openapi.ts` — deterministic OpenAPI emitter.
- `scripts/vet-openapi.ts` — OpenAPI compat gate CLI (merge-base baseline vs candidate).
- `openapi.json` · `users-openapi.json` · `agent-openapi.json` — committed generated wire artifacts.
- `src/openapi-changes.ts` · `src/openapi-schema-diff.ts` · `src/openapi-diff.ts` ·
  `src/openapi-vet.ts` · `test/openapi-diff-endpoints.test.ts` ·
  `test/openapi-diff-schemas.test.ts` · `test/openapi-diff-errors.test.ts` ·
  `test/openapi-gate.test.ts` · `test/vet-gate.test.ts` — change vocabulary, classifier,
  gate decisions, and the workflow-wiring invariant.

## Pitfalls

- Catalog errors move in three-mirror lockstep:
  `src/errors.ts` ↔ `workers/catalog/src/lib/errors.ts` ↔
  `apps/agent/src/animichi/clients/catalog_errors.py`.
- Extend `workers/catalog/test/contract-parity.worker.test.ts` and the Python error tests with any
  mirror change; do not rely on OpenAPI generation alone.
- Do not introduce runtime value imports into the catalog's type mirror.
