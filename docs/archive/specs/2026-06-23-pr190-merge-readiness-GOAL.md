# GOAL + PLAN · PR #190 后端合并就绪 + 部署

> 2026-06-23。把 PR #190(混合后端重写,238 commits,backend-survey → main)做到**后端**合并就绪:所有机器人评论解决、多 CR skill 审到无新 finding、后端 CI 全绿,然后 merge → tag → 部署 → 验证。

## §0 范围(铁律)

- **只负责后端**:`agent/`(Python)、`catalog/`(TS Worker)、`worker/`(edge)、`packages/contract/`、`supabase/`、CI/deploy 配置。
- **前端不归我**:`frontend/`、Frontend Tests、SonarCloud/Snyk 的前端项、design-review/animations/css-audit —— 全部 OUT(前端正 TanStack 重建,另轨;由用户处理)。
- **robot pr = PR 上的机器人评论**(CodeRabbit / SonarCloud / qodo / codecov),不是 dependabot 依赖 PR。

## §1 完成定义(Definition of Done)

1. **后端 CI 绿**:Backend Quality ✓、Backend Tests ✓、DB Migrations(dry-run)✓(Supabase 已恢复,已验证绿)。
2. **机器人评论全解决**:CodeRabbit、SonarCloud Quality Gate、qodo、codecov —— 抽出**后端相关** finding,逐条修复或回应并 resolve;前端 finding 标注 out-of-scope。
3. **多 CR skill 审到无新 finding**:每个后端 CR skill 各开一个 sub-agent(`review`、`health`、`devex-review`、`audit`、`critique`),对后端 diff 审查;finding 收集 + 对抗式复核(adversarial verify)+ 修复 Critical/Important;**循环直到一整轮无新 finding**。
4. **后端 Sonar/Snyk finding 修复**(安全/质量);前端项跳过。
5. **全程 make check 绿**(mypy + 单测 + 覆盖 ≥80%);**无任何抑制**(no `# type: ignore`/`noqa`/eslint-disable/skip,除非用户批准)。
6. 然后:merge #190(前端 check 由用户处理绿)→ tag `v0.3.0` → CI 部署(catalog→root+容器+迁移)→ **mails.dev 真登录拿 token 验 /v1**。

## §2 当前状态(基线)

- ✅ main 已恢复 689526c;PR #190 开着(238 commits)。
- ✅ Supabase 项目恢复;db-validate 由 fail("tenant not found")→ **pass**。
- ✅ 后端:Backend Quality/Tests 绿、Frontend Build 绿。
- ❌ 前端 Frontend Tests fail(FoxGuide unoptimized 等)——**out-of-scope**。
- ⏳ 机器人评论待处理;多 CR skill 审查未做。
- A′ edge /v1 网关 + monorepo P0-P3 已完成(见各 spec)。

## §3 PLAN(分阶段;每阶段后 make check 绿 + 小步提交)

### Phase 1 — 机器人评论分诊 + 解决(后端)
- 拉取 #190 全部机器人评论:CodeRabbit(行内 + summary)、SonarCloud(Quality Gate 明细)、qodo(若恢复)、codecov(覆盖)。
- 分诊:**后端相关** → 逐条修(或回应说明)并在 PR 上 resolve thread;**前端相关** → 标 out-of-scope 一句话回应。
- 每修一批 → make check → commit。

### Phase 2 — 多 CR skill 审查(每 skill 一个 sub-agent,loop-until-dry)
- CR skill 集(后端):`review`、`health`、`devex-review`、`audit`、`critique`(+ `reviewer` agent 视需要)。
- 每个 skill 开一个 sub-agent,审后端 diff(`origin/main..backend-survey`,限 agent/catalog/worker/packages)。
- 收集所有 finding → **对抗式复核**(每条派独立 skeptic 验真伪,默认 refute)→ 仅留真 finding。
- 修复 Critical/Important(每修 → make check → commit);Minor 记录。
- **循环**:修完后再跑一轮全 skill;**直到一整轮零新 finding** 才算过(loop-until-dry)。

### Phase 3 — Sonar/Snyk 后端修复
- SonarCloud Quality Gate 的**后端**问题(bug/smell/security hotspot/coverage)→ 修。
- Snyk 的**后端依赖/代码**漏洞 → 修或评估(dependabot 依赖项归前端的跳过)。
- 前端项一律 out-of-scope。

### Phase 4 — 终审 + 合并 + 部署 + 验证
- 后端全绿 + CR 无 finding + 机器人评论 resolved。
- opus 全分支后端终审(可选合成审)。
- 前端 check 由用户处理绿 → **merge #190** → `git tag v0.3.0 && push` → CI 部署。
- 部署后:`mails` CLI(已装 v1.5.6)走 QA 用户(`seichijunreiqa@mails.dev`)magic-link 真登录拿 token → 打 deployed `/v1` 验认证 + agent + catalog(顺便验 ~50% pg 挂在 prod 是否消失)。

## §4 执行约束

- 每 CR sub-agent 派发用 `subagent_type`/Skill,模型按复杂度;findings 经 file 交接不污染主上下文。
- "强制全过":指**修到真绿**(修代码),非抑制/跳过 check。前端 required check(frontend-test)由用户处理——若它阻塞 merge,与用户确认前端侧绿化或临时豁免。
- 不动前端代码;不碰 prod 直到 §1 全满足 + 用户确认 merge。

## §5 风险 / 待确认

- frontend-test 是 deploy 的 required gate(ci.yml `needs`)——后端绿不够,merge/deploy 仍需前端 check 绿(用户处理)。
- prod catalog 无 Hyperdrive 走裸 DATABASE_URL(SUPABASE_DB_URL)——部署后验证连库 + ~50% 挂是否只 dev。
- 238-commit PR 巨大;CR 聚焦后端 diff + 机器人评论,不逐行全审历史。
