<div align="center">

# 聖地巡礼 Animichi

**AI 驱动的动漫圣地搜索与路线规划**

[![CI](https://github.com/lifeodyssey/animichi/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/lifeodyssey/animichi/actions/workflows/ci.yml?query=branch%3Amain)
[![Python 3.11+](https://img.shields.io/badge/python-3.11+-3776ab.svg)](https://www.python.org)
[![TanStack Start](https://img.shields.io/badge/TanStack_Start-SSR-FF4154.svg)](https://tanstack.com/start)
[![Cloudflare Workers](https://img.shields.io/badge/deploy-Cloudflare_Workers-f38020.svg?logo=cloudflare)](https://developers.cloudflare.com/workers/)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres-3ecf8e.svg?logo=supabase)](https://supabase.com)
[![GitHub last commit](https://img.shields.io/github/last-commit/lifeodyssey/animichi)](https://github.com/lifeodyssey/animichi/commits/main)
[![GitHub stars](https://img.shields.io/github/stars/lifeodyssey/animichi?style=flat)](https://github.com/lifeodyssey/animichi)

[**在线体验**](https://seichijunrei.zhenjia.org) | [架构文档](docs/ARCHITECTURE.md) | [部署指南](docs/ops/deployment.md)

[English](README.md) | [日本語](README.ja.md) | [中文](README.zh.md)

</div>

---

用自然语言告诉 Agent 一部动漫的名字或一个地点，它会找到现实中的圣地巡礼地点、在地图上展示，并规划步行路线——一轮对话搞定。

## 工作原理

```
用户输入 → PydanticAI Agent（animichi_agent）
              ├── resolve_anime  → catalog Worker 标题解析; 未命中时 Bangumi 入库
              ├── search_bangumi → 已解析 bangumi_id 的 catalog 点位
              ├── search_nearby  → catalog 地理检索（Neon 上的 PostGIS）
              ├── plan_route     → catalog 路线排序
              └── web_search / translate → 带出处调研 / 标题翻译
           → AgentResult（类型化输出 + 工具调用记录）
```

单一 PydanticAI Agent 负责规划和工具调度。工具使用 `ModelRetry` 守卫拒绝无效参数，`output_validator` 检测捏造的响应。选定点路线绕过 Agent 直接执行。

`resolve_anime` 具有自进化能力：首次查询未知标题时，从 Bangumi.tv 获取元数据并写入数据库，后续查询直接命中本地 DB。

## 主要功能

- **对话式搜索** — 支持日语、英语、中文提问，Agent 自动判断意图
- **自进化动漫目录** — DB 优先，Bangumi.tv API 写穿透补全
- **地理检索** — 根据坐标或站名搜索附近圣地
- **路线规划** — 最近邻算法排序，支持用户自选地点
- **生成式 UI** — 三栏布局（聊天面板 + 交互结果面板）
- **边缘认证** — JWT（magic-link）和 API Key 认证在 Cloudflare Worker 层执行
- **评估套件** — 50+ 规划质量用例，覆盖 3 种语言

## 快速开始

```bash
# 安装 Python 依赖
uv sync --extra dev

# 本地启动服务
make serve

# 运行测试
make test              # 单元测试
make test-integration  # 稳定版集成测试
make test-all          # 单元 + 集成
make test-eval         # 模型评估测试（需要 LLM 访问）
make check             # lint + 类型检查 + 测试
```

## 数据库迁移

Neon catalog 与 user 数据面的 schema 变更统一记录在 `migrations/neon/`，由固定版本的
Atlas CLI 应用；`migrations/neon/atlas.sum` 是生成的完整性清单，必须和迁移文件一起更新。
Worker 中的 Drizzle schema 仅用于运行时查询和类型，不生成也不执行迁移。剩余的
Supabase 迁移目录只服务 auth/旧版兼容面，不能作为 Neon 新表的来源。

```bash
make db-list           # 列出仓库中的 Atlas 迁移
make db-hash           # 重新生成 migrations/neon/atlas.sum
make db-validate       # 校验 checksum 与 SQL 结构
make db-push-dry       # 对 NEON_DATABASE_URL 做 dry-run
make db-push           # 对 NEON_DATABASE_URL 应用迁移
```

边界、CI 门禁和部署顺序见 [`docs/ops/migrations.md`](docs/ops/migrations.md)。迁移应在部署时的专用步骤中执行，而非应用启动时。

## 环境变量

**必需（agent 容器 / 本地 serve）：**
| 变量 | 用途 |
|---|---|
| `SUPABASE_DB_URL` | agent 域 Postgres 连接字符串 |
| `SUPABASE_URL` | Supabase 项目 URL（auth + API key 查询面） |
| `SUPABASE_SERVICE_ROLE_KEY` | 服务端 Supabase 认证 / `api_keys` 查询 |
| `MIMO_API_KEY` | 主模型供应商密钥 |
| `DEEPSEEK_API_KEY` | 边缘 container-env 容器启动必填（转发进容器） |

**Worker 边缘：** `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`（JWT 用公开 JWKS 校验 — 边缘不需要 `SUPABASE_ANON_KEY`）。catalog/users/jobs 还需各自 Neon DSN — 见 [`docs/ops/deployment.md`](docs/ops/deployment.md)。

**可选：** `SERVICE_HOST`, `SERVICE_PORT`, `OBSERVABILITY_*`, `DEFAULT_AGENT_MODEL`

详见 [`apps/agent/src/animichi/config/settings.py`](apps/agent/src/animichi/config/settings.py) 和 [`.env.example`](.env.example)。

## 使用示例

**Python（直接调用）：**
```python
from animichi.agents.animichi_runner import run_animichi_agent
from animichi.infrastructure.supabase.client import SupabaseClient

async def main() -> None:
    async with SupabaseClient(db_url) as db:
        result = await run_animichi_agent("吹響ユーフォニアムの聖地", db, locale="ja")
        print(result.output)
```

**HTTP（API Key）：**
```bash
curl -X POST https://seichijunrei.zhenjia.org/v1/runtime \
  -H 'Authorization: Bearer sk_your_key_here' \
  -H 'Content-Type: application/json' \
  -d '{"text":"吹響の聖地","locale":"ja"}'
```

## 仓库结构地图

- `apps/agent/` — Python 运行时：agents、interfaces、infrastructure、tests、tools
- `workers/catalog/` — 动漫目录 API + 数据平台 Cloudflare Worker（TypeScript）
- `workers/users/` — 用户域数据 Worker（`/v1/users/*`）
- `packages/contract/` — 共享 oRPC/zod 契约（catalog ↔ agent ↔ users）
- `apps/web/` — TanStack Start SSR Web 应用（**唯一浏览器面**）
- `workers/edge/` — Cloudflare Worker 入口：认证与 `/v1` 路由
- `migrations/neon/` — Neon 数据面的 Atlas 迁移与生成的 checksum
- `supabase/` — auth/旧版兼容迁移与 Supabase 项目资产
- `docs/` — 架构文档、运维文档、迭代资料与实现计划
- `Makefile`、`package.json` — 根目录工具入口；`apps/agent/Dockerfile`（容器镜像）与 `workers/edge/wrangler.toml`（edge Worker 配置）随代码存放

## 文档

- [架构文档](docs/ARCHITECTURE.md) — 系统设计参考
- [部署指南](docs/ops/deployment.md) — Cloudflare Workers + Containers 部署
- [迁移边界](docs/ops/migrations.md) — Atlas authority 与 Drizzle 查询/类型边界
- [运维文档](docs/ops/README.md) — 运维手册与环境流程
- [迭代资料](docs/iterations/README.md) — 按迭代归档的 task plan、progress、findings
- [实现计划（归档）](docs/archive/plans/) — 历史执行计划（平层 `plans/` 不再新增）
- [设计规格](docs/specs/) — 现行产品/架构规格
- [Agent 指南](AGENTS.md) — monorepo 布局、命令与跨栈护栏
