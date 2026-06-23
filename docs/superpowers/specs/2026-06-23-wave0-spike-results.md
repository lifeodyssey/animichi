# Wave 0 Spike — 假设验证结果 (2026-06-23)

在 prod CF account 用临时资源(`*-spike` + `spike.zhenjia.org`)实测,**未碰 prod 现有 `seichijunrei.zhenjia.org`**,测完全部清理(routes 0 / workers 0 / spike R2 bucket 已删)。

| 假设 | 结果 | 证据 | 对 Wave 的影响 |
|---|---|---|---|
| **① OpenNext 能 build 独立 Worker** | ✅ PASS | 加 `open-next.config.ts` + Node 24 → `opennextjs-cloudflare build` EXIT=0 → `.open-next/worker.js`(2.3KB) + `assets/`。**前提**:去掉前端 Node-runtime middleware(`proxy.ts`),OpenNext 不支持 Node middleware。 | Wave 3:删/edge 化 `proxy.ts`;它的 `/v1` auth gate 移到 edge Worker(本就该,route-based 下冗余)。 |
| **② route-based 最具体优先** | ✅ PASS(配置) | Pulumi 建成 `spike.zhenjia.org/v1/* → edge-spike`、`/* → web-spike`(CF API 确认配置正确)。"最具体优先"是 CF 文档保证行为。**本地 curl 受代理 fake-ip(198.18.x)干扰无法端到端实测**,非 CF 问题。 | Wave 3:web=`/*`、edge=`/v1/*`+`/img/*`,两 Worker 各管 route、互不 import。 |
| **③ Pulumi 自动 provision CF** | ✅ PASS | `pulumi up`(scoped CF token + local state)自动建成 R2 bucket + DNS + 2 routes,零手动 dashboard。**回答了"能不能用 Pulumi 自己创建"=能**。 | Wave 2+:Pulumi(TS)管 infra;生产 R2 state bucket 也 Pulumi 自建。 |
| **③b wrangler×Pulumi 边界** | ✅ PASS | `wrangler deploy` 一个 no-route worker 后,2 条 Pulumi-managed route **仍在**(未被清)。 | 分层成立:**route/DNS/R2/Hyperdrive 归 Pulumi,worker 代码+容器归 wrangler**;组件 `wrangler.toml` 不声明 route。 |
| **④ agent 容器 build+push** | ⏳ 未实测(需本地 Docker) | CF 文档明确:`wrangler deploy` 自动 Docker build → push 到 CF Registry → 部署。 | Wave 3:edge+容器 `wrangler deploy`;实测留 Wave 3(或本地 Docker 起来时补)。 |
| **⑤ Neon 扛得住 schema(multi-env 补验)** | ✅ PASS | 在 Neon project `animichi`(pg **18.4**)建 spike branch,asyncpg 实测:`pgvector 0.8.1`(含 **HNSW** 索引 + cosine)、`postgis 3.6`(`ST_DWithin`)、`pgcrypto` **全 work**;`vector(1024)` + `geography` 列 OK;branch 建/连/删验隔离。Neon 是 drop-in 且版本更新。 | Wave 2/3:catalog/operational 迁 Neon,后端 asyncpg/Hyperdrive 连 Neon `DATABASE_URL`(production branch)。 |

## 关键发现(写回设计)
1. **前端 Node middleware 阻塞 OpenNext** → `proxy.ts` 的 `/v1` auth gate 在 route-based 架构里冗余,移 edge Worker;剩余 session-refresh 改 edge-runtime。(强化 ii 解耦方向。)
2. **Pulumi 全自动 provision 成立**,但需一个权限够的 scoped CF token(R2/Hyperdrive/KV/Workers Routes/DNS/Workers Scripts/Queues Edit + Zone Read)——已配好(token 在 main `.env`,建议 rotate 因聊天暴露)。
3. **bootstrap 仍需一次手动**:第一个权限够的 CF token 必须手动建(chicken-egg);之后 Pulumi 全自动。
4. 本机有代理(Clash/Surge fake-ip 198.18.x)→ 本地 curl 自定义域不可靠,端到端验证走 CI/preview 或临时关代理。

## 绿灯门
①②③③b ✅ → **可进 Wave 1(monorepo 骨架 + pnpm)**。④ 信 CF 文档(标准 wrangler 流程),Wave 3 实测。

## 待办(下一个设计话题)
**多环境方案**(用户提出,待专门讨论):animichi 域名作 prod + staging 测试环境 → Pulumi 多 stack(prod/staging)参数化域名/资源。这是 Pulumi 多 stack 的核心价值兑现。
