# Tool routing (repo-specific; global tooling lives in `~/.claude/` — do not repeat it here)

Read before picking a skill, an MCP server or a dispatch channel for a task.

- **Skill-first** — invoke the Skill tool before acting when a request matches: bugs → `/investigate` ·
  ship/PR → `/ship` · qa → `/qa` · review → `/review` · docs → `/document-release` · retro → `/retro` ·
  design system → `/design-consultation` · visual → `/design-review` · architecture → `/plan-eng-review` ·
  quality → `/health` · brainstorm → `/office-hours`. TDD: `/frontend-tdd` (React).
- **Orca card delivery** — backend/Infra/CI-CD Ready for Dev → merged PR follows
  `docs/ops/orca-card-delivery.md`: writers from the coordinator skill's roster, invoking `/implement`
  when their Skill tool allows it, different-model Matt review workers, three review rounds maximum,
  all PR feedback resolved before merge. This scoped owner choice overrides the opencode
  executor route for those cards.
- **Web browsing** → `/browse` (gstack). Never `mcp__claude-in-chrome__*`.
- **CodeGraph** — `.codegraph/` is initialized; follow the **global** CodeGraph rules in `~/.claude/CLAUDE.md`
  (spawn an Explore agent for exploration; only lightweight `codegraph_*` lookups in the main session).
- **MCP servers — when to reach for each on this stack** (existence is config; this is the *when*):

  | Server | Use it for |
  |---|---|
  | Neon (`mcp__Neon__*`) | The **data plane** (catalog/user tables). Prisma 8 owns the schema — one chain in `packages/pi-session-neon/migrations/` is the whole migration authority (#1636) — and since #1633 every catalog/users query is a builder plan over that contract. Branch/query Neon. |
  | Cloudflare (`cloudflare-*`) | Workers/Wrangler docs, bindings, builds, observability for the edge/catalog. |
  | context7 | Current library docs for the exact stack (Hono, Prisma 8, oRPC, AI SDK, TanStack Start). Prefer over memory. |
  | serena | LSP-backed semantic code nav/edits when codegraph isn't enough. |
  | logfire | Observability — the agent and Workers share the Logfire dashboard. |

- **Stack skills — invoke the Skill tool when the task matches** (docs fallback = context7 for any lib without a skill: Hono, oRPC, Prisma 8, TanStack Start):

  If a plugin skill is missing, install it with `claude plugin install <plugin>@<marketplace>` (for example
  `logfire@pydantic-skills`, `pulumi@pulumi-agent-skills`,
  `better-auth@better-auth-agent-skills`, `cloudflare@cloudflare`).

  | Skill | Reach for it when |
  |---|---|
  | `logfire:logfire-instrumentation` · `logfire:logfire-query` | Instrumentation / querying observability. |
  | `cloudflare:workers-best-practices` · `cloudflare:wrangler` · `cloudflare:durable-objects` | Catalog/edge Worker code, `wrangler.toml`, bindings, local `wrangler dev`. |
  | `neon` / `neon-postgres` | Neon data-plane queries, branching, egress tuning. |
  | `pulumi:pulumi-best-practices` · `pulumi:pulumi-component` · `pulumi:pulumi-esc` · `pulumi:pulumi-automation-api` | IaC in `infra/` — Cloudflare R2 / routes / DNS / secrets, stacks, ESC. |
  | `better-auth:create-auth-skill` · `better-auth:better-auth-best-practices` | Auth work as we migrate onto Neon Auth (Better Auth) (`workers/users`, login). |
  | `ai-sdk` | Frontend AI SDK streaming/UI in the TanStack rebuild (`apps/web`). |
