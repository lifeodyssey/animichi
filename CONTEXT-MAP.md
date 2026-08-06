# Context map — Animichi

Multi-context monorepo. Glossaries are pure language (no implementation). Layout target: `docs/superpowers/specs/2026-08-06-monorepo-target-layout.md`.

Consumer rules: `docs/agents/domain.md` (when present). Per-package `CONTEXT.md` files are **created lazily** when a term or decision is resolved — missing files are normal.

## Contexts

| Context | Glossary | Deployable / home |
| --- | --- | --- |
| **Contract** (published language) | [`packages/contract/CONTEXT.md`](./packages/contract/CONTEXT.md) | `packages/contract` |
| **Catalog** | [`workers/catalog/CONTEXT.md`](./workers/catalog/CONTEXT.md) | `workers/catalog` |
| **Users** | [`workers/users/CONTEXT.md`](./workers/users/CONTEXT.md) | `workers/users` |
| **Agent** | [`apps/agent/CONTEXT.md`](./apps/agent/CONTEXT.md) | `apps/agent` |
| **Edge** | [`workers/edge/CONTEXT.md`](./workers/edge/CONTEXT.md) | `workers/edge` |
| **Web** | `apps/web/CONTEXT.md` (lazy) | `apps/web` |
| **Jobs** (retention cron; was Maintenance) | `workers/jobs/CONTEXT.md` (target; today `workers/maintenance/CONTEXT.md`) | `workers/jobs` (target path) |
| **Migrations** | `migrations/CONTEXT.md` (lazy) | `migrations/neon`, `migrations/supabase` (target paths) |
| **Infra** | `infra/CONTEXT.md` (lazy) | `infra` |
| **Auth appliance** | — | `supabase/` (auth-only, no package guide) |
| **Browser E2E** | `e2e/CONTEXT.md` (lazy) | `e2e/` |

System-wide ADRs: `docs/adr/` (incl. [0002 published language](./docs/adr/0002-published-language-point-bangumi-itinerary.md)).

Greenfield (no dual wire names / table aliases):  
[`docs/superpowers/specs/2026-08-06-greenfield-language-and-data-plane.md`](./docs/superpowers/specs/2026-08-06-greenfield-language-and-data-plane.md).

## Relationships

- **Web → Edge**: Browser talks only to the public edge (and its own Worker for SSR assets as configured).
- **Edge → Agent / Catalog / Users**: Gateway; Edge resolves **Identity**, does not own pilgrimage models.
- **Agent → Catalog**: Customer–supplier; Agent needs Points / Bangumi / Itineraries; Catalog owns master data and planning.
- **Users → Catalog (by id only)**: **SavedRoute** stores `point_ids`, not Point rows; Users does not redefine Point.
- **Agent ↔ Users**: Claim anonymous **Session** / saved data after login (via Users APIs / product flows).
- **Jobs → Agent data plane**: Cron retention jobs over anonymous Session / quota tables; no public route (`workers/jobs`, was maintenance).
- **All → Contract**: Published language for cross-boundary DTOs; prefer glossary terms above over ad-hoc synonyms.

## Core vocabulary (cross-context)

| Term | Means | Avoid |
| --- | --- | --- |
| **Point** | Visitable seichi stop | PilgrimagePoint (legacy type name), Spot in contracts |
| **Bangumi** | One anime title in the catalog | Work, Anime-as-title |
| **Itinerary** | Computed ordered plan | bare Route |
| **SavedRoute** | User-owned saved record | bare Route |
| **Session** | Agent dialogue context | auth cookie “session” without qualifier |

## Domain model presence (skeleton refactor)

| Package | Pilgrimage `domain/` | Notes |
| --- | --- | --- |
| `workers/catalog` | **Yes** (target) | Full CA: domain / application / adapters |
| `apps/agent` | **Yes** (target) | Domain free of FastAPI/PydanticAI runtime imports |
| `workers/users` | **Shallow** | Pure rules + ports; no heavy DDD tree |
| `workers/edge` | **No** | Gateway only — never `src/domain/` for pilgrimage |
| `apps/web` | **No** | UI — no `src/domain/` |
| `workers/jobs` (today `maintenance`) | **No** | Job + Schedule only |
| `infra` | **No** | Topology / Cloudflare only |
| `packages/contract` | N/A | Published language, not a BC with domain/ |

Campaign: [#829](https://github.com/lifeodyssey/animichi/issues/829) · path tracker: [`docs/iterations/refactor-skeleton-2026-08/PATH-DELTA.md`](./docs/iterations/refactor-skeleton-2026-08/PATH-DELTA.md) · structure index: [`docs/superpowers/specs/2026-08-06-structure-refactor-index.md`](./docs/superpowers/specs/2026-08-06-structure-refactor-index.md).
