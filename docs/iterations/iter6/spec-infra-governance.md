# Infra 治理 spec 草案(epic #674)— owner grill 版

日期 2026-08-03 · 分支 feat/frontend-rebuild · 全部数字为本机实测(gh secret/variable list、源码 grep、CF docs 检索)。

## 1. Secrets 中央化(Pulumi ESC)

**现状实测**:三分体系共 **51 个名字**——GH repo secrets **27**(其中 ≥7 个 dead:GCP_SA_KEY/GCP_PROJECT_ID/CLAUDE_CODE_OAUTH_TOKEN/ANTHROPIC_API_KEY/ANTHROPIC_BASE_URL/NEXT_PUBLIC_MAPBOX_TOKEN/ZETA_API_KEY)+ staging env **10** + production env **10** + GH vars repo 4 / staging 2 / prod 0 + Pulumi passphrase config(prod 1 secret `catalogDatabaseUrl`+salt;staging 无 secret)。同名双写(repo+env)8 组,repo 层副本全部 unreachable(env 覆盖规则,docs/ops/secrets.md 已证)。**注意**:issue 里说的 `CLOUDFLARE_PULUMI_API_TOKEN` 已在 `_deploy-component.yml:449/502` 接线,但 `gh secret list` 三个 scope 均**未见此名** → 本地 commit 2e3a9c12 未推或 secret 未 provision,当前 Pulumi 步骤实际拿到空 token(`required: false` 静默)。**这是 P0 修复项,先于 ESC。**

**目标态**:ESC 为唯一真源,GH env 只留 bootstrap 凭证。结构(层叠继承,官方 best practice"base → provider → stack"):
```
animichi/base            # 非密 config + 共享名(ANITABI_API_URL 等)
animichi/cloudflare      # CF 三 token(§2)+ ACCOUNT_ID
animichi/staging         # imports: base, cloudflare; env 专值+secret
animichi/prod            # 同上; PULUMI_CONFIG_PASSPHRASE 淘汰(见下)
```
**接线方案对比**:(A) GH Actions OIDC → Pulumi Cloud(ESC 官方 OIDC issuer 信任 GH),job 内 `esc run animichi/<env> -- <deploy>` 注入 env;(B) 保持 GH secrets 为镜像、ESC 只作登记。**推荐 A**:零长期静态凭证进 GH,轮换只改 ESC 一处;B 不解决三分散,只加第四份。wrangler 喂法不变:`esc run` 导出的 env 直接被 wrangler-action `secrets:` / `wrangler secret put` 消费,`_deploy-component.yml` 的 `${{ secrets.X }}` 改为 step env 读取。**留在 GH 的**:`GITHUB_TOKEN`(内建)、Codecov OIDC(已无 token)、`PULUMI_ACCESS_TOKEN`(ESC 的 bootstrap 凭证,鸡生蛋,必须留 GH env)、`GITLEAKS_LICENSE`(未 set,维持)。**顺带收益**:ESC 用 Pulumi Cloud 托管加密 → `PULUMI_CONFIG_PASSPHRASE`+R2 state 的"丢 passphrase 即丢 state"风险面消失(state 后端是否同迁 Pulumi Cloud 是独立决策,可不迁)。

**迁移批次(每批独立可回滚 = 保留旧 GH secret 直到批验证过,回滚仅改 workflow 一行)**:
B0 修 `CLOUDFLARE_PULUMI_API_TOKEN` 断线(推 2e3a9c12 + provision)。B1 清 7 个 dead secrets(按 secrets.md 逐行动作,GCP_SA_KEY 先撤销)。B2 建 ESC env + OIDC 信任,仅迁 **Pulumi 自身消费**的 5 个(PULUMI_*、R2_*、CLOUDFLARE_PULUMI_API_TOKEN)。B3 迁 catalog/users 面(NEON_DATABASE_URL、NEON_API_KEY)。B4 迁 root 容器面(11 个 container-chain secrets)。B5 删 GH 侧已迁副本 + 更新 secrets.md 为"ESC 指针文档"。

**守卫**:扩展 `test_secrets_docs_consistency.py`——A 集合加入"ESC env yaml 中声明的名字"(esc env 定义可 export 成 JSON 进 repo fixture);CI 加 `esc env get --format json | jq` 断言每环境必需 key 非空(名字级,不碰值)。

## 2. 最小权限 token 矩阵

| 消费者 | 现状 | 目标 scope | 轮换 |
|---|---|---|---|
| wrangler deploy(4 Workers+container) | `CLOUDFLARE_API_TOKEN` 全权,repo+双 env 三份同名 | Workers Scripts:Edit + Containers(registry push)+ Workers R2:仅当 wrangler 绑定校验需要;**staging/prod 各一枚** | ESC 单点;新旧并行→切→撤销 |
| Pulumi(R2/DNS/Routes/Ruleset/CustomDomain) | 专用 token 已接线但**未 provision**(见 §1 P0) | R2:Edit + Zone DNS:Edit + Zone Rulesets:Edit + Workers Routes:Edit,zone 限 animichi.com | 同上 |
| Neon(CI branch 管理) | `NEON_API_KEY` 全账号 | Neon 支持 project-scoped API key → 限 `billowing-fire-22850320` | 同上 |
| Turnstile siteverify | `TURNSTILE_SECRET`(仅是 widget secret,无 API token 面) | 维持;preflight 已有 siteverify 探针 | 换 widget 对 |
| Logfire | 双 env 各自 write token(已最小) | 维持 | 已有流程 |
| R2 state 读写 | R2_* 账号级 S3 key | 限 bucket 的 R2 API token(CF 支持 bucket-scoped) | ESC 单点 |

## 3. Artifact promotion(容器镜像 build-once-promote)

**现状**:`wrangler.toml` 三处 `image = "./Dockerfile"` → staging 与 prod 各自现场重建,prod 跑的 digest ≠ staging 验过的。
**平台事实(CF docs 实测)**:Containers 支持预构建镜像 `image = "registry.cloudflare.com/<account>/<img>:<tag>"`(也支持 Docker Hub/ECR/GAR);CI 路径官方支持 `wrangler containers build -p -t <tag>` / `containers push`。文档只示例 **tag 引用,`@sha256:` digest 引用未见文档确认** → 按 digest 部署标记为**待 spike 验证**。
**推荐方案**:build-once-promote 可行——CI 在 staging deploy 前 `wrangler containers build -p -t <git-sha>`(immutable tag,等效 digest 固定),`image` 字段改为 registry 引用;deploy 步骤用同一 `<git-sha>` tag 先 staging 后 prod(prod 不再 build)。wrangler config 不支持 image 字段插值 → CI 以 `sed`/生成片段写入 tag,或 spike `WRANGLER_` env 替代。**兜底**(若 registry 引用在 container+DO 组合下有坑):保留双重建,但两次 build 后 `docker inspect` 记录 digest,post-deploy 步骤比对 staging/prod digest 一致才放行 prod(弱保证:需 BuildKit 可重现层,不达标就告警不阻断)。
**守卫**:CI 断言 prod deploy job 无 docker build 步骤(或 digest 比对必须绿);`wrangler.toml` 测试断言 `image` 是 registry 引用非 Dockerfile 路径。

## 4. Private network 补全

**已做**:catalog/users 全环境 `workers_dev=false`(catalog 3 处+users 3 处,实测);catalog/users 无公共路由(smoke 步骤明示 by design);`catalog.internal` outboundByHost→service binding(容器→catalog 不出公网);root `workers_dev=false`(#539,staging 例外:显式 `workers_dev=true`,是 promotion gate 契约)。
**半做**:staging WAF gate(#529/#559)代码已在 `infra/index.ts:186-221`,`stagingGateEnabled=false` 且依赖 #541 hostname cutover(workers.dev 域名绕过 zone WAF——staging 现恰恰只有 workers.dev 入口,**gate 今天开了也没用**)。
**缺失**:ingest 内部化(#540/#555)——`/catalog/ingest` 仍是 fetch handler 路径靠共享 secret,应改 named `WorkerEntrypoint` + binding-only(注入的 agent 也无法伪造 binding 调用);#529 决策(staging CORS wildcard)未定。
**收口顺序**:N1 ingest WorkerEntrypoint(#540,独立可做,防注入面最大)→ N2 hostname cutover(#541,前置)→ N3 staging WAF gate 开启(#529/#559,依赖 N2)→ N4 staging `workers_dev` 关闭改走 staging.animichi.com(重写 promotion gate 断言)。
**守卫**:`infra/topology-*.test.ts` 已有,扩展断言"staging gate enabled 时 stagingDomain 必在 zone 上";wrangler 配置测试断言 catalog/users 永无 routes/workers_dev。

## 5. 命名与守卫

**改名批次**(配合 #312 Supabase 退役;借 ESC 迁移批同车,一次名字只改一处真源):R1 `SUPABASE_DB_URL`→`AGENT_DATABASE_URL`(触点:GH/ESC + `_deploy-component.yml` + `deploy.yml` + `CONTAINER_ENV_KEYS` + `CONTAINER_REQUIRED_KEYS` + settings.py + secrets.md,env 三触点教训);R2 `NEON_DATABASE_URL`→`CATALOG_DATABASE_URL`;R3 `MIMO_API_KEY` 等模型 key 维持(名已语义)。每批新旧名并读一个 release(settings 层 alias)再删旧名。
**配置守卫扩展**(`worker/authConfig.test.ts` 模式 → 新 `worker/secretsWiring.test.ts` + `.github/` contract test):可写断言——(a) `worker_secrets`/`post_deploy_secrets` 列表 ⊆ `_deploy-component.yml` `secrets:` 声明 ∩ env map(三处一致);(b) `CONTAINER_ENV_KEYS` 中 credential 形名字必在某 workflow env map 出现(ZETA/OPENAI_COMPAT 断链即红);(c) wrangler.toml 各 env `image`/`workers_dev`/services 形状钉死;(d) Pulumi 步骤 env 必用 `CLOUDFLARE_PULUMI_API_TOKEN` 而非 wrangler token(防回退)。

## 分卡建议(执行顺序)

1. **C0** P0:推/provision `CLOUDFLARE_PULUMI_API_TOKEN` + dead secrets 清理(B0+B1)— 半天
2. **C1** Token 矩阵落地:三枚 CF token + Neon project-scoped key + R2 bucket-scoped(§2)
3. **C2** ESC bootstrap:env 结构 + GH OIDC + 迁 Pulumi 面 5 secrets(B2)
4. **C3** ESC 全量:B3+B4+B5 + secrets.md 改指针 + 守卫测试扩展(§1 守卫)
5. **C4** Ingest WorkerEntrypoint 内部化(#540/#555,N1)— 与 C2 并行无依赖
6. **C5** Artifact promotion spike + 落地(§3,含 digest 引用验证)
7. **C6** Hostname cutover + staging WAF + workers_dev 收口(N2-N4,依赖 owner 定 #541/#529)
8. **C7** Secret 语义化改名 R1/R2(依赖 C3 的单一真源,#312 同车)

**Owner 决策点**:① ESC 方案 A(OIDC+esc run)是否接受引入 Pulumi Cloud 依赖;② state 后端留 R2 还是同迁;③ promotion 采 registry-tag 方案还是 digest 比对兜底;④ #529 staging CORS 决策;⑤ C6 与产品 launch(#541 即上线)耦合,时点归 owner。
