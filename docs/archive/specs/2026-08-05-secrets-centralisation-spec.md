# Secrets Centralisation — Pulumi ESC 单一真源(epic #674 第 1 条)— Spec

| | |
|---|---|
| **Status** | Draft — 调查+设计,待 owner 审签。实施另开卡。 |
| **Date** | 2026-08-05 |
| **Base commit** | `main` @ 2026-08-05(工作树 `docs/s0v2-B6-secrets-esc-spec`;无代码改动) |
| **Scope** | 只产 spec。不动任何真实密钥、不改 GitHub secrets/variables、不改 `infra/Pulumi.*.yaml`。 |
| **Related** | epic #674(第 1 条);issue #527(closed,reusable caller 无 environment);#485/#492/#522/#528/#541/#559;iter6 `docs/iterations/iter6/spec-infra-governance.md`(epic 草案,本 spec 是其正式化与细化) |

> **证据标注约定**(沿用 2026-07-29 cicd-rebuild spec):**[measured]** 可复跑的命令/源码证据(含实测时间);**[cited]** 官方文档;**[unverified]** 未经本机核实、不得作为实施依据,必须先 spike(§11)。
>
> **方法论注记(S1 修正)**:`pulumi:pulumi-esc` skill **本机已安装**(`~/.claude/plugins/marketplaces/pulumi-agent-skills/pulumi/skills/pulumi-esc`,v2026-07-08)且**已读**;其官方 CLI 形态、env YAML 结构、9 条 best practices 已按原文核入本 spec(§4/§6/§11 分别标注「skill 已确证」vs「仍 [unverified]」)。skill 未覆盖的(GH Actions OIDC 接 ESC 的具体形状、ESC 与 GH env secrets 共存策略、免费层配额/审计保留期)继续标 [unverified] 并列入 §11。`pulumi:pulumi-best-practices` 同源规则另对照 infra/AGENTS.md 已固化部分(§4 Q5)。

---

## 1. Why — 今天(2026-08-05)的实证

staging 从 04:39 起部署全挂,Pulumi 连 R2 state 后端 **401**。根因:owner 04:47 轮换 R2 key 时更新了 repo 级与 `CLOUDFLARE_PULUMI_API_TOKEN`(三层都更),但**漏了 staging/production 两个环境级的 `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`**。

这不是疏忽个例,是结构缺陷的必然结果:同一个密钥要手工同步在**三处**(repo GH secret + staging env secret + production env secret),其中两层还因「same-name override rule」(`docs/ops/secrets.md:44-58`)在部署时是真正生效的那层。漏一处 = 静默故障 —— 部署时 Pulumi 不会因为「repo 层轮换了、env 层没换」给出任何提示,它只是拿旧值 401。

活体切片(物证):[measured 2026-08-06 `gh secret list --env staging`,2026-08-06 复核一致] staging 里两把 R2 钥的更新时间是 `2026-08-05T17:47:06Z / 17:47:07Z`(事故后 17:47 修复轮换的补录),而 `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_PULUMI_API_TOKEN` 是同日 `04:47`(04:47:38Z / 04:47:40Z)——**这道时间戳裂缝(17:47 vs 04:47,跨 13 小时)就是「三处手工同步漏一处」的物证**。

同一缺陷的其它已归档实锤:

- **#527**:调 reusable 的 caller job 不能声明 `environment:`,`${{ secrets.X }}` 在 caller 层取 repo 级值再作为 `secrets:` 输入传递。**推论(卡片已核实)**:repo 级副本看似冗余,实则是传递链的取值来源,**不能删**——直到整条 GH 取值链被替换为止。
- **同名双写共 10 组**(repo+env,[measured] 2026-08-06 `gh secret list` 三 scope 实测),repo 层副本全部 unreachable 但必须存在(上述 #527)。
- **`STAGING_GATE_TOKEN`** 一份值要同时活在 GH staging env secret 和 `infra/Pulumi.staging.yaml` 的 `secure: stagingGateToken` 里,靠 `scripts/setup-staging-gate.sh --rotate` 脚本原子同步——脚本丢了或改坏,两处就漂移,CI 被 WAF 403 锁出 staging(secrets.md:129)。
- **`SUPABASE_DB_URL` 是第 9 组同名双写,且不对称**(本卡盘点的活体发现,F2):[measured] 2026-08-06 `gh secret list --env staging` 显示 staging 环境级存在一份副本(设置时间 `2026-08-03T05:49:29Z`),`gh secret list --env production` 无此名。secrets.md:124 把它整体记为「repo (no env override)」——文档没记录这份 env 级副本。按 same-name override rule,**今天轮换 repo 级 `SUPABASE_DB_URL`,对 staging 部署完全无效**——与 2026-08-05 R2 事故一字不差同型,**是「下一个 R2 事故候选」**(§8.4)。
- **`catalogDatabaseUrl` 是死副本(advisory 查证结论)**:[measured] `infra/index.ts:34-43` 注释自陈「CI deploy-catalog job 把该值传给 `wrangler secret put DATABASE_URL`」,但实测 CI 传的是 **`secrets.NEON_DATABASE_URL`**(`reusable-deploy-component.yml:586/673`、`ci.yml:726/781/890/931`),Pulumi 的 `catalogDatabaseUrl`(Pulumi.prod.yaml:3-4 的 committed 密文,index.ts:43 导出)**没有任何消费点**。结论:P4 删掉它,而非迁进 ESC(§2.4、§6 P4)。
- **`AGENT_DATABASE_URL` 三个 scope 均不存在,而 maintenance 部署 lane 有 fail-closed 检查(F1,活体缺陷)**:[measured] 2026-08-06 `gh secret list`(repo 28 名 / staging 12 名 / production 11 名)**全无此名**;但 `reusable-deploy-component.yml:104-109` 对它有「empty/unset → exit 1」的 fail-closed 前置检查,`ci.yml:799-801`、`deploy.yml:99-101` 也经 caller 传递该名。CI 历史 [measured 2026-08-06]:**maintenance lane 从未绿过**——3 次 fail-closed 失败(2026-08-03T16:28 那次附 `exit code 1`),其余各次均因上游失败被 skip。即:该 lane 要么从没跑过、要么一直在红;iter6 R1 规划的 `SUPABASE_DB_URL→AGENT_DATABASE_URL` 改名(#312 联动)也未执行,名字进了工作流、值从未 provision(§2.2、§8.4)。

epic #674 第 1 条原文:「Secrets 三分散:GH env secrets + wrangler secrets + Pulumi passphrase config,无中央源(`docs/ops/secrets.md` 是清单不是管控)。目标:Pulumi ESC 单一真源。」iter6 草案(2026-08-03)已定方向:方案 A——GH Actions OIDC → Pulumi Cloud,`esc run` 注入 env,仓库零长期静态凭据;state 后端**留 R2**(passphrase 保管是固有成本)。本 spec 把该方向落成可审、分阶段、每步可回退的实施设计。

---

## 2. 现状:三分散(外加第四处)完整清单

> [measured] 依据:`docs/ops/secrets.md` Live 表 + `.github/workflows/*` 的 `secrets:` 映射 + `infra/Pulumi.*.yaml` + `workers/edge/containerEnv.ts`。**「存在哪几处」= GitHub secret 所在 scope(名字级,2026-08-06 三 scope 只读实测,命令 `gh secret list` / `gh secret list --env staging` / `gh secret list --env production`);「谁消费」= 消费它的工作流/代码。值一律不出现。** 工作流/源码 line-ref 以 PR head 复核(2026-08-06,main 两次合并入分支后)。
>
> **真源规则(直到 P5 cutover;PR #819 review finding 3 采纳)**:迁移期内,凡本 spec 的 [measured] 断言(2026-08-06 实测)与 `docs/ops/secrets.md` Live 表冲突,**以本 spec 为准**——secrets.md 由 `test_secrets_docs_consistency.py` 测试强制校验,但它同时也是本卡指出的失实源头(§2.2 三处:secrets.md:114 对 `CLOUDFLARE_PULUMI_API_TOKEN` 只记 env 层、:121 对 `AGENT_DATABASE_URL` 记「staging+production environment secrets only」、:124 对 `SUPABASE_*` 记「no env override」,均与本卡实测冲突)。冲突行必须随**该阶段 commit** 同步修正 secrets.md(§9.4 硬性要求),不允许「spec 与 secrets.md 互斥」越过一个阶段窗口;迁移期内一切轮换/供给/审计操作以 §5 归属表与 §2 实测为真源,操作前先核对 §9 守卫。

### 2.1 第一处:GitHub repo-level secrets(取值链的传递层,#527)

| 密钥 | 消费(经 caller 传递,由被调 job 的 env 级值覆盖) |
|---|---|
| `CLOUDFLARE_API_TOKEN` | wrangler deploy / post-deploy push / smoke(env 级生效) |
| `CLOUDFLARE_PULUMI_API_TOKEN` | 仅 run_pulumi 的 Pulumi 两步(env 级生效;#527 取值链成员)。**repo 级副本存在**([measured] 2026-08-06 `gh secret list`,设置时间 `2026-08-05T04:47:18Z`)——secrets.md:114 只记 env 层,失实;本卡修正(FIX3) |
| `CLOUDFLARE_ACCOUNT_ID` | 所有部署步(R2 endpoint 派生;非凭据,secrets.md:115) |
| `PULUMI_BACKEND_URL` · `PULUMI_CONFIG_PASSPHRASE` | Pulumi state(env 级生效) |
| `R2_ACCESS_KEY_ID` · `R2_SECRET_ACCESS_KEY` | Pulumi state backend + rollback 备份上传(env 级生效) |
| `NEON_DATABASE_URL` | Atlas migrate + catalog/users Worker `DATABASE_URL`(env 级生效) |
| `LOGFIRE_TOKEN` | 容器面(env 级生效;三份值各不相同) |
| `MIMO_API_KEY` · `DEEPSEEK_API_KEY` · `GOOGLE_MAPS_API_KEY` | 容器面(无 env 覆盖) |
| `SUPABASE_URL` · `SUPABASE_ANON_KEY` · `SUPABASE_SERVICE_ROLE_KEY` | 容器面 / edge / web build(无 env 覆盖;SD-31 迁移中) |
| `SUPABASE_DB_URL` | 容器面 / edge / web build(**repo + staging 环境级双写,F2**;production 无 env 副本;SD-31 迁移中) |
| `TURNSTILE_SECRET` · `ANON_ID_SECRET` | post-deploy push → CF Worker secret store(无 env 覆盖) |
| `NEON_API_KEY` | ci.yml / neon-test-base.yml 测试 lane(无 env 覆盖) |
| `GITLEAKS_LICENSE` | reusable-security.yml(引用但**未设置**,有意,secrets.md:128) |

### 2.2 第二处:GitHub environment-level secrets(部署时真正生效的那层)

| 密钥 | scope | 消费 |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | staging + production | 同 2.1 第一行,env 值覆盖 repo 值 |
| `CLOUDFLARE_PULUMI_API_TOKEN` | staging + production + **repo,三层俱在**(FIX3;env 层为 #674 最小权限分离,2026-08-05 已 provision;repo 层副本 [measured] 2026-08-06 `gh secret list`,设置时间 `2026-08-05T04:47:18Z`) | 仅 run_pulumi 的 Pulumi 两步(secrets.md:114 只记 env 层——失实,本卡修正;repo 副本经 caller 传递,同 #527,不可删) |
| `CLOUDFLARE_ACCOUNT_ID` | staging + production | 同上,非凭据 |
| `PULUMI_BACKEND_URL` · `PULUMI_CONFIG_PASSPHRASE` | staging + production | Pulumi state |
| `R2_ACCESS_KEY_ID` · `R2_SECRET_ACCESS_KEY` | staging + production | Pulumi state backend + 备份上传(**本次事故漏掉的两层**) |
| `NEON_DATABASE_URL` | staging + production | Atlas migrate + catalog/users Worker |
| `AGENT_DATABASE_URL` | **三 scope 均不存在**(F1,[measured] 2026-08-06:repo 28 名 / staging 12 名 / production 11 名全无此名) | maintenance Worker(secrets.md:121 记的是「staging + production environment secrets only」——**文档失实**;`workers/jobs/wrangler.toml` 三环境 `required`,`src/index.ts:33-34` 缺值即 throw) |
| `SUPABASE_DB_URL` | **staging only**(F2,[measured] 2026-08-06 设置于 `2026-08-03T05:49:29Z`;production 无——不对称) | 容器面 / edge / web build;**按 same-name override rule,staging 部署取 env 级值,repo 级副本对 staging 无效** |
| `NEON_AUTH_JWKS_URL` | staging + production | edge 双 issuer 验证(URL,非凭据;SE 低,secrets.md:123) |
| `LOGFIRE_TOKEN` | staging + production | 各环境独立 Logfire 项目 |
| `CORS_ALLOWED_ORIGIN` | production only(staging 用 `wrangler.toml` vars,secrets.md:102-105) | 容器 CORS 中间件 |
| `STAGING_GATE_TOKEN` | staging only | staging WAF gate 的 `x-staging-key`;与 Pulumi `secure: stagingGateToken` 双写 |

### 2.3 第三处:Cloudflare Worker secret store(运行时)

- `TURNSTILE_SECRET` · `ANON_ID_SECRET` — edge Worker 运行时读(`workers/edge/turnstile.ts`、`auth.ts`),由 CI post-deploy push 灌入两个环境。
- `DATABASE_URL`(catalog/users 的 binding 名,值 = `NEON_DATABASE_URL`)、`AGENT_DATABASE_URL`(maintenance)— deploy 时经 wrangler-action `secrets:` 灌入。**注意 F1**:`AGENT_DATABASE_URL` 的运行时 binding 在 `workers/jobs/wrangler.toml` 三环境 `required`,但 GH 三 scope 无此 secret → maintenance 部署在 `reusable-deploy-component.yml:104-109` 的 fail-closed 前置检查就 exit 1,**从未到达过 secret put 这一步**(§2.2)。
- 容器面 10 个(secrets.md 链 1 的 `worker_secrets` 清单)同样落在容器 Worker 的 secret store。
- **运行时存储不可能也不应该被 ESC 替换**——ESC 是供给端真源,运行时 store 留在 Cloudflare(见 §4 Q1)。

### 2.4 第四处:Pulumi stack passphrase config(不在 GitHub,自成一套)

| key | 位置 | 消费 |
|---|---|---|
| `stagingGateToken`(secure) | `infra/Pulumi.staging.yaml:52-53` | `index.ts:373` `config.requireSecret` → WAF 规则集表达式;与 GH `STAGING_GATE_TOKEN` 同值双写 |
| `stagingAllowedIps`(secure) | `infra/Pulumi.staging.yaml:50-51` | `index.ts:385` WAF 白名单 |
| `catalogDatabaseUrl`(secure) | `infra/Pulumi.prod.yaml:3-4`(committed 密文);staging 按注释以 CLI per-stack 设置(`Pulumi.staging.yaml:47-48`,[unverified] 是否在 live 栈侧) | **死副本(advisory 查证结论)**:`index.ts:34-43` 注释自陈「CI deploy-catalog job 把该值传给 `wrangler secret put DATABASE_URL`」,实测 CI 传的是 `secrets.NEON_DATABASE_URL`(`reusable-deploy-component.yml:586/673`、`ci.yml:726/781/890/931`);`catalogDatabaseUrl` 全仓**无任何消费点**——唯一功能性引用是 index.ts:43 的导出本身,其余匹配均为注释/文档(`index.ts:37`、`Pulumi.staging.yaml:47-48`、`reusable-deploy-component.yml:488`「Pulumi stack export」步注释、`deployment.md:468`、iter6 草案与 plan archive 的历史记录)→ **P4 删除,不迁 ESC**(§6 P4,含陈旧注释一并清理) |
| `encryptionsalt` | 两个 yaml 均有 | passphrase 派生加密 key 的 salt(非独立密钥) |
| 明文配置 | `cloudflareAccountId`/`cloudflareZoneId`/`webDomain`/`stagingDomain`/两个 flag | 非密钥,§2 清单外 |

### 2.5 计数

[measured **2026-08-06**,命令 `gh secret list` / `gh secret list --env staging` / `gh secret list --env production` 及 `gh variable list` / `gh variable list --env staging`,三 scope 只读实测]现网三分散共 **60 个名字**(= 28+12+11+6+3):GH repo secrets **28**(≥7 dead,secrets.md「Referenced by nothing」)+ staging env **12** + production env **11** + GH vars **6**(repo 4 个为模型/项目 ID 类,staging 2 个为 `VITE_*`;均为公开构建配置)+ Pulumi secure config 3(`stagingGateToken` / `stagingAllowedIps` / `catalogDatabaseUrl`)。同名双写 **10 组**(repo+env;第 9 组为 `SUPABASE_DB_URL` 的 staging 不对称副本,F2;第 10 组为 `CLOUDFLARE_PULUMI_API_TOKEN` 的三层副本——repo 级 2026-08-05T04:47:18Z,FIX3)。

> 注:上一版引用 iter6 的 27/10/10/8 是 2026-08-01 快照,已废弃——本卡因 8 月 5 日轮换漏同步而立案,底稿必须用立案日后的实测。

---

## 3. 目标形态

```
GitHub Actions(ci.yml / deploy.yml)
  │  job 级 `environment:` 保留 ── 它是生产审批门,不再是取值渠道
  │  permissions: id-token: write        ◄── OIDC,仓库零长期凭据(方案 A,iter6 决策①已定)
  ▼
pulumi/esc-action @v1(或 esc CLI:esc run <env> -- <cmd>)
  │  ── esc login(OIDC 换短期令牌;兜底 PULUMI_ACCESS_TOKEN)──►
  ▼
Pulumi Cloud ESC ── 单一真源
  animichi/base ──► animichi/staging ──► animichi/prod      (层叠 import,官方 base→env 结构)
  │  values: secrets / environmentVariables / pulumiConfig
  ▼ env exports(名字级注入 deploy 进程)
  Deploy 步: pulumi login(CLI 直登 R2) · pulumi up · Atlas migrate ·
              wrangler deploy / wrangler secret put · smoke / post-deploy asserts
  ▼
Cloudflare: Worker secret store(运行时,原样)· R2 state · wrangler vars
```

- **GH 侧最终只保留**:`GITHUB_TOKEN`(内建)+ 未迁名单(§7)。若 OIDC 接线受阻,兜底为每环境 1 枚 `PULUMI_ACCESS_TOKEN`(§4 Q1/Q2)。
- **`wrangler secret` 运行时 store 不动**:ESC 只替换「把值喂给部署管线的来源」,Worker 代码、绑定、运行时零改动。
- **`infra/Pulumi.staging.yaml` / `Pulumi.prod.yaml` 的 secure 块**迁入 ESC 的 `pulumiConfig`,两个 yaml 只留明文配置 + flag——顺带收窄 `pulumi stack export`(rollback 备份,R2 `rollback-backups/`)里的密文面。

---

## 4. 五个调查问题

### Q1. ESC 能不能覆盖三类密钥源?(含第三个的鸡生蛋)

| 密钥源 | 覆盖? | 形态 |
|---|---|---|
| ① GitHub Actions 两层(env + repo) | **能** | ESC 的 base/env 层替换两层取值。**注意**:`environment:` 声明在 job 上**必须保留**——它是生产审批门与防护规则(reusable-deploy-component.yml:92);只是它的「取值」职能被 ESC 取代。#527 的 repo 级副本会随 caller 的 `secrets:` 表达式**整条链一起消失**(ESC 一次拆掉 GH 取值链,不存在「只拆一层留一层」的中间态) |
| ② `wrangler secret`(Worker 运行时) | **能(供给端)/不能(运行时)** | ESC 是 deploy 管线的值源:`esc run` 导出的 env 被 wrangler-action `secrets:` 与 `wrangler secret put` 步照旧消费(secrets.md 链 1/链 2 的**递送机制不变**,只换来源)。Worker 的运行时 secret store 留在 Cloudflare——ESC 不做运行时注入,运行时行为零变化 |
| ③ `PULUMI_CONFIG_PASSPHRASE` | **能,但有一个不可入 ESC 的例外** | 见下 |

**鸡生蛋问题的答案**:passphrase 解密 Pulumi state,若它自己也存进 ESC,启动顺序必须是「先拿到 ESC 登录凭据 → 登录 ESC → 打开 env 拿到 passphrase → 再碰 state」。这链成立,**因为 ESC 登录是独立、前置的一步**:

1. `esc login`:OIDC(GH Actions 的 `id-token` 换 ESC 短期令牌)或 `PULUMI_ACCESS_TOKEN`。
2. `esc run animichi/<env> -- <deploy 命令>`(或 esc-action)把 `PULUMI_CONFIG_PASSPHRASE`、`PULUMI_BACKEND_URL`、`R2_*`、`CLOUDFLARE_PULUMI_API_TOKEN` 注入进程 env。
3. 之后的 `pulumi login "$PULUMI_BACKEND_URL"` / `pulumi up` 在进程 env 里就能读到全部所需值,passphrase 在 pulumi 读取 state 之前已就位。

**唯一不能进 ESC 的是「ESC 登录凭据本身」**——这是 bootstrap:理想态 OIDC = 零长期凭据;兜底态 = 1 枚 `PULUMI_ACCESS_TOKEN` 留在 GH(env 级,审计可见)。`GITHUB_TOKEN` 同理(内建)。

**关键残留风险(必须接受并管理,iter6 决策②已定)**:passphrase 存进 ESC 后,「丢 passphrase 即丢 state」的风险面仍在——ESC env 被误删、ESC 账号被锁,等于 passphrase 一起没了。对策:secrets.md 已有的「Back it up outside this repo」纪律升级为**双备份**(离线保管 + §8 每阶段验证时导出一次 ESC 完整 env 到离线),任何时刻 passphrase 至少有两处独立于 ESC 的副本。

### Q2. GitHub Actions 怎么从 ESC 取值?

- **官方 action**:`pulumi/esc-action`(Pulumi 官方 GitHub Action)。职责 = `esc login` + 打开指定环境并把导出值注入后续 step 的 env。[unverified: 精确输入名(`environment` / `login` / `oidc` / `token`)与版本号 —— pulumi-esc skill 未覆盖 GH Action 层,spike 核对]
- **CLI 等价形态**(**[skill 已确证]** 官方 CLI:`pulumi env init/edit/set/get/open/run`,`pulumi env run <env> -- <cmd>` 优先于 `open`;esc CLI 随 pulumi CLI 一起安装):repo 现有 `pulumi/actions`(reusable-deploy-component.yml:436/556 已用 v7.0.0)安装的是同一套 CLI,[measured] `pulumi login "$PULUMI_BACKEND_URL"` 直登模式已是现状(docs/ops/integration.md:26),`pulumi env run` 可包住现有步骤,最小侵入。
- **OIDC(理想态,iter6 决策①)**:workflow 声明 `permissions: id-token: write`;ESC 环境定义里信任 GitHub OIDC issuer,subject/audience 限定到本 repo(防别家 workflow 借 token);esc-action 以 `oidc: true` 交换 GH 签发的短期令牌。[unverified: identity 块精确 schema / audience 约定 —— skill 未覆盖,spike 以官方文档为准;skill 侧已确证的方向性表述是「OIDC 优于静态密钥」]
- **兜底**:`PULUMI_ACCESS_TOKEN` 作为 GH env secret(每环境一枚或 repo 一枚 + 审计),esc-action `token:` 输入。**OIDC 不通时这是唯一留在 GH 的长期凭据**,且它只买 ESC 的读权限,不直接碰任何业务密钥。

### Q3. 迁移路径(可回退的分阶段方案)

完整方案见 §8。总则:**每阶段只改工作流取值来源,不动值、不动 GH 侧副本;验证通过才进下一阶段;回退 = revert 该阶段的工作流 commit(GH 副本仍在,值未变,秒级复原)**。值的删除(GH 侧清理)只发生在最后一个阶段(§8 Phase 5),且以「连续 N 次 staging+prod 全绿 + hash 奇偶校验一致」为前提。

### Q4. 哪些密钥不该进 ESC?(分类判据)

五条判据,按序判定:

1. **是不是密钥**:含凭据材料(secret/token/key/passphrase/带口令 DSN)→ 进 ESC。非密钥(URL、ID、域名、公开 token、数值)→ 走 config 通道,不是本卡的迁移对象。
2. **谁消费**:deploy/CI 时点消费 → 进 ESC(它能持有一个 ESC session)。仅运行时消费 → 真源可放 ESC 但运行时 store 不动(§4 Q1②)。
3. **是否多地点同步**:今天存在于 ≥2 处、轮换要全部照顾 → **最高迁移优先级**(本次事故的类别)。单地点 + 脚本原子同步 → 低优先级,可留。
4. **环境范围**:env 级值 → per-env ESC 层;import base;「只在一个环境用」本身**不是**留在 GH 的理由(ESC 的 per-env 层天然支持)。
5. **外部撤销面**:provider 侧可吊销的值(CF token、Neon key…)迁移后轮换 = 在 ESC 换值 + 在 provider 侧重建,轮换路径要写进 runbook(§8 验证步含轮换演练)。

应用结果见 §7(不迁清单与理由)。

### Q5. 对照 `pulumi:pulumi-best-practices`

**S1 修正**:`pulumi:pulumi-esc` skill 本机已装且已读(v2026-07-08),以下对照采用其官方 best practices 原文,而非凭印象;`pulumi:pulumi-best-practices` 同源规则(密钥不落明文、不写进 commit、层叠、最小权限)以 infra/AGENTS.md 已固化部分补足:

| 官方实践(skill 原文) | 本方案状态 |
|---|---|
| 敏感值一律 `fn::secret` | §8 每个名字的 ESC 层均声明为 secret 语义;env 定义模板入仓只放名字,值经 `pulumi env set --secret` 灌入 |
| **OIDC 优于静态密钥** | §4 Q2 主路径即 OIDC;PAT 仅为兜底 |
| 命名要具体:`<org>/my-app/production-aws`,不是 `<org>/app/prod` | §3 用 `animichi/base` → `animichi/staging` → `animichi/prod`,project 名带 app 前缀,与官方命名一致 |
| **分层组合**:base → cloud-provider → stack-specific | §3 的三层 import 结构即官方 base→env 形态 |
| 挂环境到 stack 后,用 `pulumi config` 验证取值符合预期 | §6 通用验证件(hash 奇偶校验)之外,P4 增加「`pulumi preview` 读 ESC 值解析正常」验证步 |
| 需要环境变量的命令优先 `pulumi env run`,别 `pulumi env open` | §3/§6 的注入形态统一为 env run 包住部署步;不落 open |
| `pulumi env open` 只在非用不可时用,它会显露 secret | §9 守卫明确只用名字级断言,不打印值 |
| **用既有环境前先核对它认证到哪个账号/角色并取得用户确认;绝不凭名字选环境;`pulumi config env add` 会改 `Pulumi.<stack>.yaml`、改变操作凭据——未经明确确认不得执行,更不许 `--yes`** | **P0 采纳为硬性纪律**:每阶段实施前人工核对 ESC 环境所属 org/账号,`pulumi config env add` 必须 owner 在场确认后执行(写进 §10 禁区与实施卡 checklist) |
| 挂载后凭据常显示 `[unknown]` 直到 open/run——**没验证前不得声称已修好** | §6 每阶段验证明确「部署绿 + hash 校验一致」双条件才进下一阶段,不凭配置视图断言 |
| 密钥必须走 `config.requireSecret()` / `getSecret()`,不落明文 | 已是现状(`index.ts:373/385/43`),迁移后 secure 块移入 ESC 反而**更严**:`pulumi stack export`(无 `--show-secrets`)导出的密文更少,rollback 备份泄露面收窄 |
| 不把 secret 写进 commit / yaml / 日志 | ESC 值只经 `pulumi env set` 灌入;repo 只放 env **定义模板**(名字级,无值);部署日志沿用 hash-prefix 纪律(§6 验证) |
| 最小权限:OIDC subject 限定 + 环境级角色 | §4 Q2 的 subject/audience 约束即此项;`CLOUDFLARE_PULUMI_API_TOKEN` 的最小权限分离(#674 已做)在 ESC 中保持 |
| `pulumi stack export` 永不 `--show-secrets` | 保持(infra/AGENTS.md Pitfalls);且随 secure 块迁移天然加强 |

---

## 5. 目标态 secret 归属矩阵(名字 → ESC 层 → 谁消费)

> 值一律 `<REDACTED>`/名字;此表是「真源迁移表」,不是值清单。**ESC 层** = 值最终存在的层(base = 两环境共用;staging/prod = 该环境独有)。

| 名字 | ESC 层 | 消费(与今天相同) |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | base? **不迁,见 §7** | — |
| `CLOUDFLARE_PULUMI_API_TOKEN` | staging / prod | Pulumi 两步 |
| `CLOUDFLARE_ACCOUNT_ID` | 不迁(非密钥,§7) | — |
| `PULUMI_BACKEND_URL` | staging / prod | Pulumi state |
| `PULUMI_CONFIG_PASSPHRASE` | staging / prod + 离线双备份 | Pulumi state 解密 |
| `R2_ACCESS_KEY_ID` · `R2_SECRET_ACCESS_KEY` | staging / prod | Pulumi state + rollback 备份 |
| `NEON_DATABASE_URL` | staging / prod | Atlas migrate + catalog/users `DATABASE_URL` |
| `AGENT_DATABASE_URL` | **先 P3a provision,再随 P3 迁**(F1:三 scope 现均不存在) | maintenance Worker(现状 lane 全红,见 §2.2) |
| `NEON_AUTH_JWKS_URL` | 不迁(URL,§7) | — |
| `LOGFIRE_TOKEN` | staging / prod(两环境不同值) | 容器面 |
| `CORS_ALLOWED_ORIGIN`(production 值) | prod(staging 仍走 wrangler.toml vars) | 容器 CORS |
| `SUPABASE_URL` · `SUPABASE_ANON_KEY` · `SUPABASE_SERVICE_ROLE_KEY` | base(SD-31 过渡期;Neon Auth 切完随退役一并清) | 容器 / edge / web build |
| `SUPABASE_DB_URL` | **staging 的 env 副本先并入 base 统一源,再随 base 迁**(F2:现状 repo+staging 不对称双写,provision 值以 staging env 副本为基准 hash 校验) | 容器 / edge / web build |
| `MIMO_API_KEY` · `DEEPSEEK_API_KEY` · `GOOGLE_MAPS_API_KEY` | base | 容器面 |
| `TURNSTILE_SECRET` · `ANON_ID_SECRET` | base | post-deploy push → CF Worker store |
| `NEON_API_KEY` | base | 测试 lane |
| `GITLEAKS_LICENSE` | 不迁(未 set;§7) | — |
| `STAGING_GATE_TOKEN` | **不迁(推荐),§7** | WAF gate |
| Pulumi `stagingGateToken` / `stagingAllowedIps` | staging 的 `pulumiConfig` | `index.ts` 照旧 `requireSecret`/`getSecret` 读取(ESC pulumiConfig 与 stack config 合并,机制 [unverified] 见 §11) |
| Pulumi `catalogDatabaseUrl` | **不迁 —— 删除(死副本,advisory 结论)** | 无消费点;删除 secure config + index.ts:43 导出 |

---

## 6. 分阶段迁移计划(每阶段:做什么 / 怎么验证 / 怎么回退)

> **通用验证件**(每阶段全适用):
> - 部署绿:staging 全组件 deploy + Smoke + post-deploy api suite 过;生产组件一过 staging 即触发。
> - **hash 奇偶校验**:沿用 reusable-deploy-component.yml「Report resolved secret shape」(170-186 行)的 sha256_8 前缀纪律。**该步当前只输出 4 名**(`NEON_DATABASE_URL` / `NEON_AUTH_JWKS_URL` / `PULUMI_BACKEND_URL` / `LOGFIRE_TOKEN`;PR #819 review finding 1 采纳)——某阶段的名字集不在其中时,须在该阶段**同一 commit 内扩展该步**(补 env 输入 + sha256_8 输出行),扩展本身是阶段验收的一部分;**不允许出现「名字已迁、但无哈希可对」的状态**。扩展须遵循该步自身注释(135-152 行)的逐变量判据:仅限高熵值(Neon DSN、R2 密钥、passphrase、CF token 均满足);**`TURNSTILE_SECRET` 这类「长度本身含语义」(Site Key 24 vs Secret Key 35)的值永不加哈希行**,其迁移验证改走功能探针(siteverify)。迁移某名字前,先记录 GH 侧基线前缀(名字级);迁移后该步改读 ESC 值,输出前缀与基线**必须一致** → 证明 ESC 副本与 GH 副本同值,这是「迁移没搬错」的核心证据。不一致 → 停,回退。
> - **迁移期冻结轮换**:某名字进入迁移窗口后,对该名字冻结轮换,直到 GH 侧副本删除(§Phase 5)为止——新旧并存期轮换只改一处 = 复刻 2026-08-05 事故。
> - **回退动作(通用)**:revert 该阶段工作流 commit 并强制重跑一次部署验证 GH 取值链复原;GH 副本在整个迁移期**不删**,值不变,回退无值迁移成本。
>
> **共同前置(Phase 0)**:Pulumi Cloud org/项目创建、ESC 环境 skeleton、OIDC(或兜底 PAT)接通。需 owner 提供 Pulumi Cloud 账号(本 repo 从未使用 Pulumi Cloud,无现成 org — [unverified] ESC 免费层配额,spike 确认)。
>
> **skill 强制纪律(P0 起生效,源自 pulumi-esc best-practice 8)**:用任何既有/新建 ESC 环境前,先核对它认证到哪个 Pulumi 账号/角色并取得 owner 确认;绝不凭名字选环境;`pulumi config env add` 会改 `Pulumi.<stack>.yaml` 并改变操作凭据,**未经明确确认不得执行,更不许 `--yes`**。挂载后凭据显示 `[unknown]` 直到 open/run——**验证通过前不得声称已修好**(best-practice 9)。

| 阶段 | 做什么 | 怎么验证 | 怎么回退 |
|---|---|---|---|
| **P0 前置/修线**(可与 P2 并行) | ① 修 `CLOUDFLARE_PULUMI_API_TOKEN` 断线——[measured] 2026-08-05 secrets.md 已确认 provision,复核 `gh secret list` 两环境在列;② dead secrets 清理按 secrets.md:131-150 逐行动作(撤销类不可回退,先行 GCP 零引用核查) | `gh secret list --env staging/production`;部署绿 | ②中删除类动作**无回退**,只做零引用核查过的行 |
| **P1 ESC 骨架 + 只读接线** | 建 `animichi/base`/`staging`/`prod` 空 env(base 只放共享名骨架,无值);ci.yml 加一个只读诊断步(名字级:打开 env 打印已解析名字集/长度,不打印值);OIDC(或 PAT)接通 | 诊断步绿;全链部署照旧绿(行为零变化);`pulumi env get` 名字级断言脚本跑通(§9) | 删除诊断步 commit;OIDC 信任若出问题,PAT 兜底或整体停用 |
| **P2 迁 Pulumi 面(事故面,最高优先)** | `PULUMI_BACKEND_URL`、`PULUMI_CONFIG_PASSPHRASE`、`R2_*`、`CLOUDFLARE_PULUMI_API_TOKEN` 入 staging/prod env;reusable-deploy-component.yml 的「Pulumi stack export」+「Pulumi up」两步改从 `esc run` 注入;其余步不动。**GH 两层副本原样保留** | staging catalog 部署绿;hash 奇偶校验 **5 名**全一致(`PULUMI_BACKEND_URL` / `PULUMI_CONFIG_PASSPHRASE` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `CLOUDFLARE_PULUMI_API_TOKEN`;该步现仅哈希其中 `PULUMI_BACKEND_URL` 1 名,其余 4 名须在 P2 同 commit 扩展输出——见通用验证件);rollback 备份对象照常落 R2;`pulumi stack export` 后做一次离线导出双备份 | revert 两步骤 commit(env 重新取自 GH);GH 值未动,秒级复原 |
| **P3 迁部署递送面(容器 + Worker 链)** | 容器面 10 个(`MIMO/DEEPSEEK/GOOGLE_MAPS/LOGFIRE/SUPABASE_*`)与 `NEON_DATABASE_URL`、`TURNSTILE_SECRET`/`ANON_ID_SECRET` 入 base/staging/prod;Atlas migrate、Deploy Worker、post-deploy push、smoke 的 env 改从 ESC 注入;`worker_secrets`/`post_deploy_secrets` 名单语义不变;**`SUPABASE_DB_URL` 以 staging env 副本为基准做 hash 奇偶校验后并入 base**(F2 的不对称双写随本次消解) | staging 全组件部署绿 + smoke + post-deploy suite;TURNSTILE 的 siteverify 探针照常过;hash 奇偶校验各名一致(**`TURNSTILE_SECRET` 除外**:长度含语义,禁止哈希行,见通用验证件——以 siteverify 探针为验证) | revert 该批 env 映射 commit;GH 副本原样 |
| **P3a 修 maintenance lane(F1,可与 P3 并行)** | `AGENT_DATABASE_URL` 三 scope 现均不存在:先给 staging/production 各 provision 一枚(agent-domain Neon DSN,值经 owner 审批),`reusable-deploy-component.yml:104-109` fail-closed 检查转绿;随后随 P3 迁入 ESC(ESC 内 staging/prod 各一份) | maintenance 部署 lane 首次全绿 + Cron Trigger Past Event 成功记录;hash 奇偶校验一致 | provision 是加新值,无回退需求;ESC 侧迁入失败则维持 GH env secret 现状 |
| **P4 迁测试 lane + 杂项** | `NEON_API_KEY`(测试 lane)、`GITLEAKS_LICENSE`(若设置)、`stagingGateToken`/`stagingAllowedIps` 从 Pulumi stack config 移入 ESC `pulumiConfig`(两个 yaml 的 secure 块删除,只留明文+flag);**`catalogDatabaseUrl` 直接删除(死副本,advisory 结论;PR #819 review finding 2 采纳):`Pulumi.prod.yaml:3-4` secure 块 + `index.ts:34-43` 注释块与 `:43` 导出一并移除,`Pulumi.staging.yaml:47-48` 的过时设置注释同步删,`reusable-deploy-component.yml:486-492`「Pulumi stack export」步注释中的 `catalogDatabaseUrl` 例证同步改写,`docs/ops/deployment.md:465-473` 的密文面讨论段落同步改写(其例证随删除失效),不迁 ESC** | 测试 lane 绿;`pulumi preview --stack staging` 读 ESC 值解析正常(`index.ts` 的 requireSecret 不报缺);WAF gate 行为不变(值未变);Atlas/部署绿;删除后 `rg catalogDatabaseUrl` 的剩余匹配**仅为历史/规划文档**(iter6 草案 `docs/iterations/iter6/spec-infra-governance.md`、plan archive `docs/archive/plans/2026-06-23-cicd-catalog.md`、本 spec 自身的迁移记录)——live 树**零消费性引用**(工作流/注释/导出/密文全部同 commit 清完) | revert commit + `pulumi config set --secret` 重灌原值(P2 的离线导出备份里有);`catalogDatabaseUrl` 回退 = 从 P2 离线备份读回原密文原样还原 |
| **P5 收口 cutover** | 连续 **2 次** staging 全绿 + 1 次 prod 全绿后:① 删 GH 已迁名字(env 层 + repo 层同时,注意 repo 层是 #527 传递链成员,整链删;**点名 `CLOUDFLARE_PULUMI_API_TOKEN`:其 repo 级副本(2026-08-05T04:47:18Z)曾被 secrets.md:114 漏记,cutover 必须两层同删,不得遗留活 token**);② secrets.md 改「ESC 指针文档」(清单 → 归属表 + 轮换路径);③ 一致性测试改断言源(§9);④ infra/AGENTS.md、deployment.md 同步 | 删除后连跑 staging+prod 部署仍绿(证明无 GH 取值残留);`rg "\$\{\{\s*secrets\."` 只剩 bootstrap/未迁名;一致性测试绿 | 值未变:从离线备份/ESC 读回,`gh secret set` 重灌两层 + revert 工作流(镜像恢复);恢复期间冻结部署 |

> **P2–P5 的名字边界**:每阶段交付时,「该阶段名字集」的 GH 引用必须在**同一 commit** 内从工作流移除并换成 ESC 注入——不允许同名双 feed(步 env 只来自一个源),否则 GH env 覆盖语义(§secrets.md 44-58)会与 ESC 注入打架,歧义即事故。

---

## 7. 明确不迁的密钥与理由

| 名字 | 判据命中 | 理由 |
|---|---|---|
| `GITHUB_TOKEN` | 内建 | GH Actions 内建,结构性存在,无 provision 路径 |
| `PULUMI_ACCESS_TOKEN`(仅当 OIDC 受阻) | bootstrap | ESC 登录凭据,鸡生蛋的不可压缩项(§4 Q1);留在 GH env 级 + 审计 |
| `STAGING_GATE_TOKEN` | 判据 3(单地点+脚本同步) | 唯一双写点由 `scripts/setup-staging-gate.sh --rotate` **原子同步**(一处脚本管 GH secret + Pulumi secure 两处),不存在本次事故的「手工多地点」类别;且它是 WAF 哨兵值——ESC 故障期留一份 GH 副本 = staging 的解锁路径。**可迁但收益低,推荐不迁**;若迁,必须连脚本一起改(§P4) |
| `NEON_AUTH_JWKS_URL` | 判据 1(URL 非密钥) | 无凭据材料,ESC 的加密保管对它无意义;中央化诉求可由「名字入 ESC 定义但值非密」满足,优先级最低,不迁 |
| `CLOUDFLARE_ACCOUNT_ID` | 判据 1(公开 ID) | 非凭据(secrets.md:115 明言「not a credential,stored as a secret for convenience」);保留现状或降级为 GH **vars**,不值得占 ESC 名额 |
| GH vars(repo 4 个为模型/项目 ID 类,staging 2 个为 `VITE_*`) | 判据 1 + 判据 2 | 公开构建期配置(repo 4 个属「非密钥 ID」类;staging 2 个 `VITE_*` 内联进公网 bundle,定义上非密),无泄露面;ESC 的保密能力用不上,保持 GH vars |
| `wrangler.toml` 的 `[vars]`(含 staging `CORS_ALLOWED_ORIGIN`、`ANON_DAILY_COST_BUDGET_USD` 等) | 判据 1 | 明文非密钥配置,入库即真源(链 3,secrets.md:96-100);不需要也不应该进 ESC |
| `GITLEAKS_LICENSE` | 判据 1 + 现状 | 未设置(secrets.md:128);设置后属「CI 消费的 license key」,可迁,但在设置之前无迁移对象 |
| dead 名单(secrets.md「Referenced by nothing」7 项) | 无消费 | 不迁,按 secrets.md:131-150 逐行处理(撤销类先行零引用核查) |

**判据速查(实施时新增密钥用)**:密钥?→ 是→ deploy/CI 消费→ 多地点同步?→ 是→ **必须进 ESC**;否→ 可留 GH(低优先);不是密钥→ config 通道,不进 ESC。

---

## 8. 风险章节

### 8.1 ESC(Pulumi Cloud)挂了怎么办

- **影响面**:所有 deploy/CI 停摆;**运行时零影响**(Worker、容器、DB 都在 Cloudflare/Neon,不依赖 ESC;state 也在 R2)。staging WAF gate 不依赖 ESC(`STAGING_GATE_TOKEN` 不迁,§7)。
- **cutover 前**:GH 副本全在,回退 = revert 工作流(§6 通用回退)。
- **cutover 后**:应急 runbook(写进 deployment.md):① 从离线双备份读回值;② `gh secret set` 重灌两层;③ revert 到 P2 前工作流形态。**前提**:备份必须独立于 ESC 存在(§4 Q1 残留风险)——若备份也只在 ESC,故障时连回退材料都没有。
- 结论:ESC 故障 = 交付延迟,不是数据或运行事故;风险等级中,缓解 = 离线备份 + 已文档化的回退 runbook。

### 8.2 passphrase 鸡生蛋与丢失

- 鸡生蛋已在 §4 Q1 解答(bootstrap 凭据独立于 ESC 内容)。真正要管理的风险是**丢失**:ESC env 误删/账号锁定 = passphrase 消失 = R2 state 不可解密(loud 失败:`pulumi up` 直接拒绝)。
- 对策:**离线双备份**(密码管理器 + §P2 每阶段一次的完整 env 导出),与 ESC 无共享信任域;secrets.md 现有「Back it up outside this repo」升级为强制双备份条目;`PULUMI_CONFIG_PASSPHRASE` 的备份动作**永远不委托给 CI**(CI 故障会连备份一起丢)。
- 附注:passphrase 入 ESC 后,**轮换 passphrase = 重加密全部 state + 全量备份**,成本高;维持「极低频轮换 + 双备份」策略即可,iter6 决策②已认可此固有成本。

### 8.3 迁移期间新旧并存的歧义

- **双 feed 歧义**:某步 env 同时被 GH env 解析与 ESC 注入 → same-name override(§secrets.md 44-58)的坑在 ESC 语境重演。对策:§6 名字边界规则——每阶段每名字,工作流引用与 ESC 注入**同一 commit 切换**,单 feed。
- **漂移歧义**:迁移窗口内轮换只改一处。对策:迁移期冻结轮换(§6 通用验证件)+ hash 奇偶校验每次部署强制(不一致即红)。
- **取值链残存歧义**:GH repo 层副本是 #527 传递链成员,若 P5 只删 env 层不删 repo 层,或反之,部署会拿到「幽灵值」(旧 repo 值经 caller 传递、被新 feed 覆盖或未被覆盖)。对策:P5 明确**两层同删同验**,删除后 `rg "${{ secrets."` 只剩 bootstrap/未迁名作为验收。
- **守卫测试的假红/假绿**:`test_secrets_docs_consistency.py` 的 A 集合来自 `${{ secrets.X }}` 文本扫描——工作流改用 ESC 后 A 集合会缩水,未同步更新测试会把「已迁」误报为「死引用」,或把「漏迁」放行。对策:§9 守卫改造与 P2 同 commit。

### 8.4 其余

- **`SUPABASE_DB_URL` 不对称双写 = 「下一个 R2 事故候选」(F2)**:staging 环境级副本(2026-08-03 设置)未被任何文档记录,secrets.md:124 至今标「repo (no env override)」。今天轮换 repo 级值 → staging 部署静默用旧值,**与 2026-08-05 R2 事故一字不差同型**。对策:P3 迁移前**冻结对该名的轮换**;迁移时以 staging env 副本为 hash 基准,两处校验一致后并入 ESC base 统一源,并同步修正 secrets.md 表格。
- **maintenance lane 全红(F1)**:`AGENT_DATABASE_URL` 三 scope 缺失 + `reusable-deploy-component.yml:104-109` fail-closed → **maintenance 的 retention 清理从未在 CI 里真正部署过**(或从未部署成功)。这是现存功能缺陷,不因本卡引入;「迁 ESC」对它无意义(没值可迁),必须先 provision(P3a)。另:secrets.md:121 记载「staging+production environment secrets only」是文档失实,一并修正。
- **OIDC 配置错误**:subject/audience 写宽 → 任何 GH repo 可借 token;写窄 → 部署 401。对策:P1 阶段用最小 subject 范围试通后再放宽,audience 固定;错误形态均为 loud 失败。
- **ESC 免费层配额/成本**:Pulumi Cloud 免费层对 env 数/secret 数/成员数的限制 [unverified]——P1 前 spike 确认;超限形态通常是「打不开 env」,loud,不会静默错值。
- **WAF gate 值漂移**(若未来 P4 决定迁 `STAGING_GATE_TOKEN`):脚本原子性消失 → 恢复为两处手工同步。对策:本 spec 推荐不迁(§7),若迁则连脚本改,且保留 GH 侧哨兵副本。
- **文档腐化**:secrets.md 的 Live 表、`test_deploy_model_env_consistency.py`、infra/AGENTS.md 均以 GH 取值链为前提;每个阶段同步更新(§9 把「文档+测试随阶段 commit」列为硬性要求)。本卡已修正三处既有失实(§2.2 `AGENT_DATABASE_URL` 的 scope 记载、secrets.md:114 对 `CLOUDFLARE_PULUMI_API_TOKEN` 只记 env 层、§2.5 计数)。

---

## 9. 守卫与一致性测试改造

1. **`apps/agent/agent/tests/unit/test_secrets_docs_consistency.py`**:A 集合从「`${{ secrets.X }}` 全量」改为「GH 侧仅剩 bootstrap/未迁名 + **ESC env 定义中声明的名字**」。ESC env **定义模板**入仓(如 `infra/esc/definitions/*.yaml`,名字级无值,值只经 `pulumi env set` 灌入),测试扫模板;B 集合 = secrets.md 两张表,逻辑不变。
2. **新增 CI 只读守卫**(P1 起):`pulumi env get <org>/<p>/<env>` 名字级断言——每环境必需名非空(名字集来自定义模板;不打印值)。[skill 已确证] `pulumi env get` 只显示静态定义、secret 值显示为 `[secret]`,可安全在 CI 只读跑;**禁用 `pulumi env open`**(它会显露真实值,best-practice 7)。
3. **`test_deploy_model_env_consistency.py`**:root job 的 secret 列表来源同步切换为 ESC 注入名清单;GH 侧只保留 bootstrap。
4. **每阶段 commit 的硬性要求**:工作流改动 + secrets.md 表 + 上述测试 + infra/AGENTS.md/deployment.md,同 commit 落地,否则守卫假红。

---

## 10. 禁区(本卡不做的)

- 不动任何真实密钥值;不 `gh secret set/delete`;不改 `infra/Pulumi.*.yaml`(P4 实施时另开卡)。
- 不实施——本 spec 审完,owner 签核后才拆实施卡。
- 不引入网络依赖/新外部服务到本卡工作流(ESC 本身除外,它是目标态的一部分,由 P0 卡建)。
- 不重查卡片必读材料(secrets.md、#527、#674 结论已按已核实引用)。

---

## 11. 待验证事项(spike 清单,[unverified] 的唯一出处)

> **S1 修正说明**:以下条目已按 `pulumi-esc` skill(v2026-07-08)核对过一轮。**已确证**(skill 原文,不再标 [unverified]):`pulumi env init/edit/set/get/open/run` 全 CLI 形态、env YAML 结构(`imports`/`values` + `environmentVariables`/`pulumiConfig`/`files`)、`fn::secret`、`fn::open::pulumi-stacks` 读另一 stack output(单个 `stack:` 字段、无 `.outputs.` 层)、`pulumi config env add <project>/<env>`(只取两段不带 org)、`pulumi env ls -o <org>`、Console 路由 `app.pulumi.com/<org>/esc/<project>/<env>`(是 `esc` 不是 `environments`)、9 条 best practices。**仍 [unverified]** 的只有 skill 未覆盖的下列条目:

| # | 事项 | 影响的设计点 | 验证方法 |
|---|---|---|---|
| S1 | `pulumi/esc-action` 精确输入名与版本(`environment`/`login`/`oidc`/`token`) | §4 Q2 接线 | 官方 marketplace 页 + 仓库 README;本机已装 esc CLI 可先做 P1 的 CLI 形态,不阻塞 |
| S2 | ESC `environment.identity` 对 GitHub OIDC 的精确 schema(subject/audience 键名)与 GH Actions `id-token: write` 配套 | §4 Q2 OIDC 形态 | 官方 ESC OIDC 文档;P1 前 spike |
| S3 | `Pulumi.yaml` `environment:` 键与**自管 R2 backend** 的组合行为:env 打开时机 vs backend 连接时机 | §4 Q1 ③;若时序不支持,退化为「部署步用 `pulumi env run` 显式注入」(本 spec 已按此为主要形态设计,故风险低) | P1 骨架期用一次性测试 env 实测 |
| S4 | ESC `pulumiConfig` 与 `Pulumi.<stack>.yaml` 的合并优先级/覆盖语义 | §5 `stagingGateToken` 等迁移 | P4 前用测试 stack 实测(注意 skill best-practice 8:实测前核对账号并取得确认) |
| S5 | Pulumi Cloud 免费层配额(env 数/secret 数/成员)与本 repo 用量(约 20 名) | §8.4 配额 | Pulumi Cloud 定价页 + 建 org 时实测 |
| S6 | ~~`esc env get` 的输出是否含值~~ **已确证**:`pulumi env get` 只显示静态定义、secret 显示为 `[secret]`;显值的是 `env open`(禁用)。守卫可只读跑 | §9 守卫 | — |
| S7 | **ESC 与 GH environment secrets 的共存/取代策略**(`environment:` 保留为审批门的同时,env secret 是否清空/保留) | §4 Q1 ①、§6 P5 | 官方文档 + P5 前实测;skill 未覆盖 |
| S8 | **审计日志保留期**(ESC 的 secret 变更/访问审计保留多久,能否满足轮换审计需求) | §4 Q2 兜底 PAT 审计、§8.4 | Pulumi Cloud 文档;skill 未覆盖 |

---

## 12. 参考

- `docs/ops/secrets.md`(Live 表、Same-name override rule、三链、Handling)
- issue #527(closed)、epic #674、iter6 `docs/iterations/iter6/spec-infra-governance.md`(§1 草案:方案 A 决策、B0-B5 批次、守卫设想——本 spec 的 P2-P5 即其正式化)
- `.github/workflows/reusable-deploy-component.yml`(取值链、hash 前缀纪律、#527 注释)
- `.github/workflows/ci.yml` / `deploy.yml`(caller 映射)
- `infra/Pulumi.staging.yaml` / `Pulumi.prod.yaml` / `index.ts`(secure config 与消费)
- `apps/agent/agent/tests/unit/test_secrets_docs_consistency.py`(守卫现状)
- `docs/ops/deployment.md` · `docs/ops/integration.md`(CLI 直登模式)
- `pulumi:pulumi-esc` skill(v2026-07-08,本机 `~/.claude/plugins/marketplaces/pulumi-agent-skills/pulumi/skills/pulumi-esc`;CLI 形态 / env YAML 结构 / 9 条 best practices 的来源)
