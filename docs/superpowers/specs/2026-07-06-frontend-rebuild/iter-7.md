# Iteration 7 — Open interfaces

Detail level: **pre-kickoff refinement**. Story count: **9** (executable stories; S7.3 "A2A" is additionally frozen as a placeholder note and doesn't count toward this train's work items — see DD-10. Originally 7, minus 1 (A2A frozen), plus 3 new (S7.8/S7.9/S7.10) = 9).

Suggested dependency order: S7.1 (eval gate unfreeze, starts independently) → S7.8 (tool typing tech-debt cleanup, prerequisite for S7.4) → S7.5 (OpenAPI publication, can run parallel to S7.8) → S7.4 (MCP server, depends on S7.8) → S7.9 (MCP Apps minimal subset, depends on S7.4) → S7.10 (MCP-as-GEO launch checklist, depends on S7.4) → {S7.2 (Claude Skill), S7.6, S7.7} (can run in parallel, depend on S7.5 being published). S7.3 (A2A) is frozen → DD-10, and doesn't participate in this iteration's dependency chain.

**SD-12 confirmed (external capability shape, main spec §②)**: iteration 7's MCP surface exposes only **task-shaped capabilities** — `resolve_anime` / `search_points` / `plan_pilgrimage(anime, constraints)` — stateless, idempotent, cacheable, thin adapters over the same existing container `/v1` contract, with **no chat passthrough exposed**. Every change in this iteration that touches the agent's behavior surface must first clear the X8 eval gate (S7.1).

**A2A deferred (backfilled from SD-25③/DD-10)**: building the A2A endpoint is frozen, registered in `docs/deferred-decisions.md` as DD-10 (trigger condition: real enterprise-orchestration-side signal / partnership inquiry / a clear consumer-facing use case emerging in the ecosystem; type = demand + external). This iteration allocates no executable story to A2A — the original S7.3 slot is rewritten as a placeholder note (see below) and isn't written up as a work item for this train.

**Prerequisite tech debt (backfilled from SD-25's prerequisite checklist)**: S7.4 (MCP server) depends on S7.8 — the 9 `@agent.tool` functions' `dict[str,object]` returns need to become Pydantic models (`FastMCP.from_openapi`'s generated `outputSchema` needs named models), and `tool_state`'s implicit call-order coupling needs to become explicit parameters (copying the shape already used by the catalog contract).

**SD-19's iteration-7 hard bar (confirmed)**: inbound — callers need an independently signed identity, tool scope defaults to read-only, parameters reuse the existing injection-detection middleware, and rate limiting is counted per caller; all of this is already written into S7.4's hard ACs. The outbound rules (no token passthrough / treat third-party tool descriptions as untrusted = tool-poisoning defense / URL SSRF checks) are mainly aimed at the "we consume a third-party MCP" scenario — since that capability itself is already frozen as DD-8 (mcp-client deferred), the outbound rules produce no new work item this iteration; they're recorded in the Decision Log purely as a prerequisite constraint for whenever DD-8 unfreezes.

**Where the injection-isolation sub-agent stands (backfilled from SD-19/SD-24①/DD-4)**: the injection-isolation sub-agent is, for iteration 7, only an **evaluation checkpoint** (whether to greenlight it as a project depends on the eval G-family scores), not a committed deliverable; wherever older documents once hard-wired it as a deliverable, this supersedes that and points to the DD-4 frozen reference instead.

---

### S7.1 Eval gate unfreeze + baseline

**Scope**: Before any change in this iteration touches the agent's behavior surface, first run a full 617-case baseline; after every story that might affect the agent surface, run a comparison eval.

**Design basis**: No visual mockup; X8 (the tiered gate established in S0.1 — this story is a consumer of it).

**Core ACs**:
- Happy path: before any agent-behavior-surface change in this iteration, capture and record one full L1 baseline eval run (the official suite, 617→~750 cases per SD-30) -> eval
- Happy path: the comparison eval after S7.4/S7.8 ship (even though they're thin adapters / pure type-narrowing) shows no significant regression under SD-30's statistical gate (per-tier bootstrap 95% CI + paired comparison; flat point-thresholds retired per SD-30③) -> eval
- Empty: if this iteration ends up making zero agent-behavior changes (purely Workers-side adapters, zero business logic), the comparison eval passes trivially (nothing to report as a regression) -> eval

**Changed files**: No new business code; mainly CI process execution and eval-report archiving; add a baseline-capture step under `.github/workflows/` if one doesn't already exist.

**Dependencies**: S0.1 (the tiered eval gate already exists).

---

### S7.2 Claude Skill launch (backfilled from SD-25①, confirmed)

**Scope**: Package the pilgrimage-planning capabilities (SD-12's three task-shaped capabilities) into a standard Claude Skill bundle and distribute it, as the first of the four shells to land — "zero new infrastructure, 0.5-1 day."

**Design basis**: No visual mockup; SD-25① (confirmed; the official line is that Skill and MCP are complementary: MCP handles the connection, Skill handles the methodology).

**Core ACs**:
- Happy path: the published `SKILL.md` follows the Claude Skill frontmatter spec — `name` ≤64 characters and equal to the skill's directory name, `description` ≤1024 characters, accurately describing the three task-shaped capabilities `resolve_anime`/`search_points`/`plan_pilgrimage` (aligned with SD-12, no mention of chat passthrough) -> integration
- Happy path: the skill bundle's `scripts/` directory contains `seichijunrei_client.py` (the same source as the Python SDK promoted to official status in S7.7 — see S7.7's cross-reference note) -> unit
- Happy path: the skill bundle's `references/` directory contains a pilgrimage-etiquette reference document (seichi junrei manners / photography and privacy etiquette essentials) -> unit
- Happy path: the skill can be installed from the public channel via `npx skills add`, or fetched programmatically via the `POST /v1/skills` endpoint -> integration
- Empty: the skill bundle duplicates zero business logic — every actual call delegates to the existing `/v1` task-shaped endpoints; resolve/search/plan logic is never reimplemented inside the skill -> unit (assertion in nature)

**Changed files**: `skills/seichijunrei-pilgrimage/SKILL.md` (new; the directory name is the skill name), `skills/seichijunrei-pilgrimage/scripts/seichijunrei_client.py`, `skills/seichijunrei-pilgrimage/references/pilgrimage-etiquette.md`, a new `POST /v1/skills` distribution endpoint (exact hosting service left to pre-kickoff refinement).

**Removed (backfilled from SD-27 / the negative list)**: the original "llms-full.txt" deliverable has been removed from this story. SD-27 confirmed "llms.txt downgrades to a static single page, the llms-full pipeline is cut," based on Ahrefs' 137K-site log data showing 97% zero requests [verified]. Iteration 0's llms.txt v1 keeps its static single-page spec; this iteration only adds one line referencing the MCP endpoint to it, in S7.10, without reintroducing an llms-full pipeline.

**Dependencies**: S7.5 (OpenAPI / task-shaped capabilities already published; the skill description aligns with it).

---

### S7.3 A2A endpoint — frozen, see DD-10 (backfilled from SD-25③)

**Status**: Not built. SD-25③ confirmed "A2A deferred: the ecosystem sits on the enterprise-orchestration side, weakly relevant to consumers, waiting for a real signal," registered as `docs/deferred-decisions.md` DD-10 (trigger condition: real enterprise-orchestration-side signal / partnership inquiry / a clear consumer-facing use case emerging in the ecosystem; type = demand + external).

This iteration allocates no story/AC/changed files to A2A, and it doesn't count toward the story count or the dependency chain. If DD-10 unfreezes in the future, the expected implementation path follows the architectural foundation already confirmed in this file (a thin adapter over the existing `/v1` contract, reusing S7.8's tech-debt cleanup and the hard-bar pattern already proven in S7.4); a new story would be opened at that point rather than reusing this number.

---

### S7.4 MCP server (FastMCP.from_openapi, backfilled from SD-25②, confirmed)

**Scope**: Use the `fastmcp` Python library's `FastMCP.from_openapi(openapi_spec)` to auto-generate an MCP server directly from the existing (SD-12-scoped) public OpenAPI schema, exposing the three task-shaped tools `resolve_anime`/`search_points`/`plan_pilgrimage`; aligned with the MCP protocol's 2026-07-28 stateless-core requirement.

**Design basis**: No visual mockup; SD-25② (confirmed) + SD-12 (capability scope) + SD-19 (iteration-7 hard bar).

**Architecture note (important — for the Coordinator to verify at scheduling time)**: `fastmcp`/`FastMCP.from_openapi` is a Python-ecosystem library, so this story lands on the `apps/agent` (existing FastAPI container) side rather than the Workers/TypeScript side — this differs from older documents that once assumed "the MCP server is a thin Workers-side (TS) adapter"; it's an architectural correction made during this backfill pass per SD-25②'s original text, and is reflected in "Changed files" below. **Per the C2 ruling** (`docs/superpowers/specs/2026-07-06-backfill-conflicts.md`, ✅ resolution section): this placement is accepted for now, but explicitly flagged to **re-verify runtime placement (Python FastMCP vs Workers/TS) before iteration-7 kickoff** — the MCP stateless-core spec and the FastMCP ecosystem's maturity may look different by the time this iteration actually starts, and locking it in this early risks staleness; this item is called out for dual-review focus.

**Prerequisite**: S7.8 (tool return types / `tool_state` made explicit — `FastMCP.from_openapi`'s generated `outputSchema` needs named Pydantic models, not `dict[str,object]`).

**Core ACs**:
- Happy path: an MCP client can discover and call the three tools `resolve_anime`/`search_points`/`plan_pilgrimage`, with `outputSchema` auto-derived from the Pydantic models, and receives a structured result -> integration
- Happy path: the MCP server is a thin wrapper auto-generated from the public OpenAPI schema — regenerating it after `openapi.json` changes keeps it in sync, with no hand-editing of tool definitions and no business logic reimplemented -> unit (assertion in nature)
- Architecture AC: the server follows the MCP 2026-07-28 stateless core — no dependency on server-side session state, every tool call is self-contained -> integration
- Error: a tool call carrying invalid/malformed constraints returns a well-formed MCP error response, not a crash -> integration
- **Hard bar (confirmed, backfilled from SD-19, in effect for iteration 7)**: inbound — callers must carry an independently signed identity (must not reuse the end user's session credentials) -> integration; tool scope defaults to read-only (consistent with the existing "all 9 tools are read-only" architectural invariant) -> unit; tool parameters reuse the existing injection-detection middleware (SD-19 P0 architecture) -> integration; rate limiting is counted per caller (not globally) -> integration

**Changed files**: `apps/agent/agent/interfaces/mcp_server.py` (new, Python side, built on the `fastmcp` library), `apps/agent/pyproject.toml` (new `fastmcp` dependency).

**Dependencies**: S7.8 (prerequisite tech debt), S7.1 (eval gate).

---

### S7.5 OpenAPI auto-publish + API docs page

**Scope**: Publish the agent's existing FastAPI auto-generated OpenAPI schema publicly, and provide a human-readable docs page.

**Design basis**: No visual mockup; X11②; SD-25 (single source of truth = the service API layer).

**Core ACs**:
- Happy path: the agent's FastAPI OpenAPI schema (auto-generated by the framework itself, not built from scratch by this story) is published at a publicly reachable URL -> integration
- Happy path: a human-readable API docs page (e.g. Swagger UI/Redoc) is rendered from that schema -> browser
- Boundary check: catalog's separate contract-based OpenAPI (`emit-openapi.ts`) stays non-public (except for the S5.4 whitelisted routes), and isn't accidentally exposed wholesale by this story -> unit (assertion in nature)

**Changed files**: `apps/web/src/routes/api-docs.tsx` (new, renders Swagger UI/Redoc), on the agent side, confirm production has OpenAPI schema public access enabled (explicitly turn it on if the framework defaults to off).

**Dependencies**: None (can start independently). This story's OpenAPI schema output is the input source for S7.4's `FastMCP.from_openapi()` (backfilled from SD-25②); scheduling should put this ahead of, or at least in sync with, S7.4.

---

### S7.6 `@seichijunrei/sdk` npm package

**Scope**: Publish a thin-shell npm package wrapping the contract client.

**Design basis**: No visual mockup; X11③.

**Core ACs**:
- Happy path: after `npm install @seichijunrei/sdk`, its typed client successfully calls the public `/v1` task-shaped capabilities (SD-12) -> integration
- Happy path: this SDK is a thin forwarding wrapper over the oRPC/OpenAPI-derived types, not a reimplementation of business logic -> unit
- Empty: calling an SDK method with a missing required parameter errors out at compile time (TS types), without needing to actually make a network request to discover it -> unit

**Changed files**: `packages/sdk/` (new package: `src/index.ts`, `package.json`).

**Dependencies**: S7.5 (OpenAPI already published; the SDK's types align with it).

---

### S7.7 Python client graduates to official status

**Scope**: Promote the existing hand-written Python client to an officially published, versioned, tested SDK.

**Design basis**: No visual mockup; X11④; the stale-docstring issue the Planner's risk register flagged (see main spec §⑨).

**Core ACs**:
- Happy path: the existing `apps/agent/agent/clients/python/seichijunrei_client.py` is published as an official, versioned, test-covered Python SDK (keeping the hand-written httpx client approach, no codegen) -> integration
- Happy path: this file's docstrings/comments are corrected to no longer imply it was "generated from OpenAPI codegen" (that implication has nothing to do with the catalog-only `emit-openapi.ts` — it's a leftover, misleading holdover) — changed to clearly state "hand-written client, targeting the agent's `/v1/*` capability surface" -> unit
- Empty: the `search()` method returns a well-typed empty response for a zero-result title, not an exception -> unit

**Changed files**: `apps/agent/agent/clients/python/seichijunrei_client.py` (docstring fixes + adding SD-12 task-shaped methods like `plan_pilgrimage` as needed), release notes documentation, `pyproject.toml` (if it needs independent packaging/release).

**Relationship (backfilled from SD-25①, pending Coordinator confirmation)**: the SDK source file this story promotes and the `scripts/seichijunrei_client.py` inside S7.2's Claude Skill bundle are two distribution faces of the same hand-written client. If the two need to evolve independently down the line (e.g. the skill bundle needs a leaner, trimmed-down version), whether to split their maintenance needs confirming when both stories are scheduled — this file doesn't presume to decide that unilaterally, and records it in the conflicts list.

**Dependencies**: None (can proceed independently); recommended to keep naming consistent with the task-shaped endpoints in S7.4/S7.5 (S7.3 is the frozen A2A placeholder and has no endpoints of its own).

---

### S7.8 Agent tool typing tech-debt cleanup (backfilled from SD-25's prerequisite checklist)

**Scope**: Clear the typing-surface prerequisites for iteration 7's MCP server (S7.4) — change the 9 `@agent.tool` functions' (`resolve_anime`/`search_bangumi`/`search_nearby`/`plan_route`/`greet_user`/`answer_question`/`clarify`, etc.) return values from `dict[str,object]` to named Pydantic models; change `tool_state` from "implicit call-order convention" to explicit parameter passing, copying the shape already used by `packages/contract`'s catalog contract style.

**Design basis**: No visual mockup; SD-25 (prerequisite tech-debt checklist) + our own CLAUDE.md typing rules (no `dict[str,object]`, no implicit ordering coupling).

**Core ACs**:
- Happy path: all 9 tools' return values are named Pydantic models (not `dict[str,object]`); `mypy --strict` passes -> unit
- Happy path: `tool_state` reads/writes pass through explicit function parameters/return values (not implicit shared-mutable-dict ordering coupling), copying the contract style already used by `packages/contract` -> unit
- Regression: after the refactor, run one comparison eval (see S7.1) confirming that pure type-narrowing doesn't change the tools' actual behavior (intent/response semantics stay consistent, `score` no lower than baseline) -> eval
- Architecture AC: the `outputSchema` that `FastMCP.from_openapi` generates corresponds to each tool's named model fields, not a generic object schema -> integration

**Changed files**: `apps/agent/agent/agents/tools.py` (or split across existing files as appropriate — each tool's return type gets reworked), `apps/agent/agent/agents/models.py` (new/adjusted Pydantic output models), `apps/agent/agent/agents/tool_state.py` (new, if needed, to carry explicit state passing).

**Dependencies**: S7.1 (the eval baseline is already captured; this story's changes must clear the comparison eval).

---

### S7.9 MCP Apps read-only card minimal subset (backfilled from SD-13 Step1, confirmed)

**Scope**: Use `@mcp-ui/server` to package at least TimedItinerary as a `ui://` read-only resource, distributed alongside S7.4's MCP server, supporting embedded rendering across hosts (Claude and other MCP clients). Scope is strictly limited to a "minimal subset" — no expansion for ChatGPT-specific fields.

**Design basis**: No visual mockup; SD-13 Step1 (confirmed: "add an MCP Apps minimal subset in iteration 7"); `docs/deferred-decisions.md` DD-19 (frozen: don't over-engineer for ChatGPT-specific fields).

**Core ACs**:
- Happy path: when an MCP client calls `plan_pilgrimage`, the response includes at least one `ui://` read-only resource (a TimedItinerary card) that supports embedded host rendering -> integration
- Happy path: that `ui://` resource is read-only (accepts no host-side write-back / interaction events), consistent with the "minimal subset" scope declaration -> unit (assertion in nature)
- Empty: a host that doesn't support `ui://` rendering still gets usable structured data (gracefully degrades to a plain data response — the call doesn't fail just because UI-rendering capability is missing) -> integration
- Boundary check (backfilled from DD-19): this story explicitly does not do — ChatGPT-specific rendering field extensions, or packaging more components beyond TimedItinerary — both are already recorded in `docs/deferred-decisions.md` DD-19 and are not added within this story's scope -> unit (assertion in nature)

**Changed files**: `apps/agent/agent/interfaces/mcp_apps.py` (new, or extended inside `mcp_server.py`), add `@mcp-ui/server` to the dependency manifest.

**Open question (pre-kickoff refinement, recorded in the conflicts list)**: `@mcp-ui/server` is a TypeScript/npm-ecosystem library, while S7.4's MCP server lands on the Python (`fastmcp`) side — how to bridge the language boundary between the two (e.g., the Python side only generates JSON conforming to the MCP UI resource spec without directly depending on that npm package; or standing up a separate thin Node layer dedicated to the rendering layer) needs to be decided during pre-kickoff refinement; this story doesn't presume a specific bridging approach yet.

**Dependencies**: S7.4.

---

### S7.10 MCP-as-GEO launch checklist (backfilled from SD-27 + seo-geo-plan.md §7)

**Scope**: GEO discoverability wrap-up once the MCP server (S7.4) is live — submit to the MCP Registry and the mcp.so/Glama directories, pass the isitagentready five-dimension self-check, and add one line referencing the MCP endpoint to the static llms.txt already live from Iteration 0.

**Design basis**: No visual mockup; `docs/superpowers/specs/2026-07-06-seo-geo-plan.md` §7's iteration-7 row ("MCP-as-GEO: MCP Registry + mcp.so/Glama submission + isitagentready five-dimension self-check + add MCP endpoint to llms.txt"); SD-27 (confirmed).

**Core ACs**:
- Happy path: MCP server metadata has been submitted to the MCP Registry and to the third-party mcp.so/Glama directories -> integration (verified via submission records / a checklist)
- Happy path: passes the isitagentready five-dimension self-check, with the self-check results archived -> integration
- Happy path: `llms.txt` (Iteration 0's static single-page version) gets one new line referencing the MCP endpoint, without changing its "static single page" positioning -> unit
- **Negative-list confirmation (backfilled from SD-27 / the negative list, guarding against backsliding)**: this story explicitly does not build an llms-full.txt maintenance pipeline, based on Ahrefs' 137K-site log data showing 97% zero requests [verified] -> unit (assertion in nature)

**Changed files**: `apps/web/public/llms.txt` (append the MCP endpoint line), submission materials/self-check records (archived under `docs/ops/` or an equivalent location, exact location left to pre-kickoff refinement).

**Dependencies**: S7.4 (the MCP server must be live before it can be registered).
