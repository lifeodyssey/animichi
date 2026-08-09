# PATH-DELTA — 目标路径 vs 现状

**Parent:** [#829](https://github.com/lifeodyssey/animichi/issues/829) · **Ticket:** [#833](https://github.com/lifeodyssey/animichi/issues/833)
**Layout target:** `docs/specs/2026-08-06-monorepo-target-layout.md`
**Structure index:** `docs/specs/2026-08-06-structure-refactor-index.md`


实现过程中更新。状态：`TODO` | `IN_PROGRESS` | `DONE` | `WONT`（附理由）。

| 目标 | 现状 | 状态 | 备注 |
|---|---|---|---|
| `workers/edge/wrangler.toml` | 根 `wrangler.toml` | DONE | Edge E1, #853 |
| `workers/edge/package.json` runtime deps | 根 `package.json` | DONE | Edge E1, #853 |
| `apps/agent/Dockerfile` | 根 `Dockerfile` | DONE | 容器 pin, #853 |
| `workers/jobs/` | `workers/maintenance/` | TODO | J1 |
| `migrations/neon/` | `db/migrations/` | TODO | DBA D19 |
| `migrations/supabase/` | 根 `supabase/` | TODO | 过渡 |
| `tests/e2e/` | 根 `e2e/` | TODO | monorepo 树 |
| `infra/src/*` | `infra/index.ts` 单文件 | TODO | Pulumi P1 |
| `reusable-package-ci.yml` | 无；`pipeline-*.yml` 复制 | TODO | CI C2 |
| catalog `domain/`… | 部分 lib/api 扁平 | TODO | structure B1 |
| agent application use cases | 主路径在 agents/runner | TODO | B2 |
| users pure rules + port | `api/routes.ts` 上帝 | TODO | B3 |
| web feature 去双栖 | `lib/chat` + `features/chat` | TODO | C2 |
| greenfield Point/Itinerary/SavedRoute | 旧 wire 名仍在 | TODO | SPIKE #852 → [RENAME-EXPAND-CONTRACT.md](./RENAME-EXPAND-CONTRACT.md) |

**规则：** 未搬完成前，代码里允许 `TODO(refactor-skeleton): move to <target>`。

<!-- ci-retrigger: force Actions webhook after outage -->
