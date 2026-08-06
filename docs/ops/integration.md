# Integration — 环境事实单一来源

一页说清:密钥分布、域名拓扑、数据链路、部署链、本地开发。S0-v2 起所有 ticket 的环境事实以本文为准;
变更本文走 `docs/DOCS_POLICY.md` 的文档规则。实时清单命令附在各节(文档写用途,存在性以命令为准)。

## 1. 密钥与凭证(三级分布)

实时清单:`gh secret list` / `gh secret list --env staging` / `gh secret list --env production`
(GitHub Environment 级**遮蔽**同名 repo 级——排障先查环境级)。

### Cloudflare 双平面 token(#674 拆分,2026-08-05 归位)

| 键 | 平面 | 权限要点 | 目标分布(S0-v2 关账态) |
|---|---|---|---|
| `CLOUDFLARE_API_TOKEN` | **wrangler=代码平面**:发 Worker、传 worker secrets、推容器镜像 | Account: Workers Scripts:Edit + Containers | **仅** staging env + production env |
| `CLOUDFLARE_PULUMI_API_TOKEN` | **Pulumi=基建平面**:路由/域名/DNS/WAF/zone 设置/R2 | Zone(animichi.com): Routes/DNS/Zone Settings/WAF:Edit;Account: Workers Scripts:Edit(Custom Domain 挂载)+ R2:Edit | **仅** staging env + production env;另有 operator-local 副本(本地 `.env`,不属 GitHub 三级) |

两平面各持一钥,泄一把不失全局。**过渡态注记**:2026-08-05 当下 repo 级仍有同名两键,
S0-v2 Track B 按 GOAL「repo 级 CF token 删除」收口——执行 ticket 以目标分布为准,不得新增 repo 级。
轮换后同步范围 = 两个 environment + operator-local `.env` + 跑 R2 派生对刷新(见下)。

### Pulumi state 后端(自管 R2,非 Pulumi Cloud)

- `PULUMI_BACKEND_URL`:`s3://` 形式带 query 的 R2 端点。**值不得带引号**(曾因带引号存 repo 级
  导致 `unknown backend cloudUrl format`);pulumi/actions 的 automation-api 不认此 URL,
  CI 一律 CLI 直登(`pulumi login "$PULUMI_BACKEND_URL"`,前置 install-only 步)。
- `PULUMI_CONFIG_PASSPHRASE`:栈密文(`secure:`)的解密口令。公开仓库允许提交密文
  (`infra/AGENTS.md` 约定;Pulumi.prod.yaml 先例),熵在 passphrase。
- `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`:S3 兼容凭证,**派生自 Pulumi 钥**
  (access key = token id,secret = sha256(token));Pulumi 钥轮换后必须重派生。

### 应用与门禁密钥(用途索引)

- `STAGING_GATE_TOKEN`(staging env):CI 过 staging WAF 闸的凭证;闸设计见 #769。
- `stagingAllowedIps` / `stagingGateToken`(Pulumi staging 栈密文):WAF IP 白名单与闸 token。
- `VITE_*` 六键(部署侧构建注入,per-env;preflight 非空校验):web 构建期配置。
  S0-v2 增 `VITE_SHOWCASE_MODE`(严格布尔契约,见 launch spec)。
- `EDGE_SHOWCASE_MODE`(edge Worker 的 `[vars]`,根/staging/production 三段):showcase 闸,
  语义同 `VITE_SHOWCASE_MODE` 的严格布尔契约——仅字面量 `"false"` 开放功能路由,
  `"true"` 使 /v1 功能路由(chat/photo-search/users)与 public catalog 读答 403,
  缺失/非法值 fail-closed(同样拒绝);/healthz、/img/*、/tiles/* 恒可达。
  staging=false、production=true、本地默认 false。仅 edge Worker 自身消费,不进 `CONTAINER_ENV_KEYS`。
- Neon/Supabase/模型 provider 键:数据面与 agent;分布以实时清单为准,用途见各包 AGENTS.md。

## 2. 域名与路由拓扑(全部 Pulumi 声明,`infra/index.ts`)

- zone `animichi.com`:ACTIVE(Cloudflare 注册商)。
- **staging**(staging 栈持有):`staging.animichi.com` Custom Domain(web)+ `/v1` 等四条路由;
  zone 级规则先例:WAF gate ruleset、http_config_settings(免浏览器挑战——CI smoke 不被
  「Just a moment」拦截;该主机防护 = IP 闸)。
- **prod**(prod 栈持有 zone 硬化:DNSSEC/CAA/限速/HSTS;apex/www/301/子域拓扑随 S0-v2 Track C 落):
  zone 级资源归属规则——staging 栈只持 staging 主机作用域的规则,zone 全局资源归 prod 栈。
- workers.dev:S0-v2 Track 0 后全关。

## 3. 数据链路

```
Anitabi /points/detail ─┐
Bangumi /v0/subjects ───┼→ catalog Worker Ingest(请求驱动;S0-v2 加 cron:种子+TTL 刷新)
image.anitabi.cn ───────┘      ↓ raw_anitabi / raw_bangumi(JSONB 重放源)+ ingest_jobs(单飞/负缓存)
                          Enrich → bangumi / points / aliases(UPSERT)
                          Publish → cluster_version(蓝绿指针);媒体 → R2 catalog-media
agent(Python 容器)= catalog 的只读消费者(不在请求期调外部 API)
users Worker = 用户数据(Hono/oRPC);maintenance Worker = 定时清理(cron 范式的参照实现)
数据库 = Neon(Atlas 迁移,db/migrations);Supabase 仅存量 auth(SD-31 迁移中,冻结)
```

## 4. 部署链

```
merge → main push → ci.yml:staging 四组件(catalog+Pulumi / web / users / root 容器)
      → post-deploy smoke(打 staging 域名;冷启动预算 ~220s)
      → production approval(GitHub production environment,人工批)
      → prod 部署 → prod smoke
兜底:deploy.yml workflow_dispatch(同 approval);rollback.yml(按组件回滚)
规则:无本地部署(hook 强制);tag 不触发任何部署
```

## 5. 本地开发

- `make dev-local`(Supabase + 后端 + web,一条命令;禁止逐个起服务)· `make local-login`(浏览器 magic link)
- `make dev-db`(agent 专用 Neon Local `:5432`)· `make check`(改动前后必跑)
- `make e2e-setup` → `make e2e`(Playwright;S0-v2 起 Test Agents 产物走晋升闸,见 launch spec)
- 排障入口:`/healthz` 的 `git_commit/git_branch` 先核对「打的是哪个后端」

## 6. 已知坑速查(实证过的)

- GitHub env 级 secret 遮蔽 repo 级;`gh secret set --body -` 写入字面 `-`(读 stdin 时省略 --body)。
- wrangler secrets-bulk 401 码语义:10000=token 坏,10026=参数错(鉴权已过)——可作探针。
- pulumi preview 在 CI 红:先查 backend URL 引号与 R2 派生对是否随 token 轮换刷新。
- GHA 打 staging 403 且响应为「Just a moment」= zone 浏览器挑战,不是应用错(已由 config-settings 规则豁免)。
