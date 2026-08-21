# GOAL — Migration Executor × CI Secrets 归零战役

- Status: ACTIVE(owner 授权拆卡 2026-08-16;spec = #1046 / `docs/specs/2026-08-16-migration-executor-spec.md`)
- **Status checkpoint(2026-08-16 下午)**:connectivity 补丁拆卡 —— 设计 spec `docs/specs/2026-08-16-migrator-neon-connectivity-spec.md`(Option 1:IPv4 pin + fail-fast probe → sleepAfter 30m + stop-on-timeout + 504 诊断体;Option 2 = worker 侧 neon-http apply,证伪后才开)。卡片 **#1100/#1101**(ready-for-agent);staging 真实触发仅在 #1100+#1101 均合入后。诊断结论:504 是掩码(容器内 atlas 无法完成到 Neon 的会话建立,sleepAfter 10m 与超时赛跑),与迁移内容/DSN/atlas 版本/worker 代码无关。
- **Status checkpoint(2026-08-16 深夜)**:#1052/#1053/#1054/#1069/#1083/#1085/#1087/#1089/#1091/#1093/#1095 全部落地并关卡(main 上 migrator 路径已通电:neon-secrets 供给 lane 首次全绿、migrator worker 部署+smoke 绿、/ledger-head 200、trigger 到达容器——首轮真实 apply 正在冷启动窗口内验证中;NEON_API_KEY 按契约保留于 provisioning lane,#1057 终局再清)。合并链上的既有阻塞已清(Edge lint、Agent atlas-httpx、zizmor template-injection、id-token caller 授权、CI startup_failure;SNAPSHOT_KEEP 为非 required 跟进项)。剩余 frontier:#1055(等 ≥3 次 staging 真实迁移证据 + SAFE-1 重钉,owner)、#1057(终局删除,cutover 窗口,owner);#1054 AC5(STAGING_GATE_TOKEN 删除,真实部署验证 session 通道后)。
- **Status checkpoint(2026-08-20,owner 接手收尾)**:**连通性根因已定,容器路径复活** —— 本地二分实验(线上同款 linux/amd64 镜像 × staging 真实 DSN × 三组对照)证明 **IPv4 pin 本身是病因**(host=IP → TLS ClientHello 无 SNI → Neon SNI 路由选不中 endpoint),去 pin 域名直连 29 秒读到 ledger;**Alpine/musl/Go TLS 全部无罪,不换基座**(证据见 connectivity spec §"Verdict (2026-08-20)")。→ 08-16 记载的"Option 1 已证伪/转 Option 2"**作废**:被证伪的是 pin 这一机制,不是容器路径;**Option 2 降为备胎**。**第二个独立死因**(与 TLS 无关,必须同修):CF 批量容器从不投递退出码事件,`runner.ts` 只认 `stopped_with_code` 为终态 → 即使 apply 成功也观察不到;**修复卡 = PR #1109**(分支 `fix/migrator-depin`):去 pin + 裸 `stopped` 当终态 + **ledger head vs expected head** 为成功判据(含 `head_mismatch` → 500、无变更运行标 `unverified`)。**owner 政策(2026-08-20 grilling 定案)**:本轮**只做 staging** —— 冻结 #1048、#1050 的 prod apply 部分、#1055、#1056 AC4、#1057、#1079/#1081(等 owner 窗口);在办 = PR #1109 → #1051 AC4 → #1047 收尾 → #1056 AC1(staging rehearsal)→ #1071 的 staging 子集(#1073 起,prod 子票仍冻)。代码由 grok CLI(grok-4.6 / xhigh / matt `/implement`)写,Claude 编排+评审+跑门禁+提交。**票据卫生**:#1049(spike job 实证全绿)、#1100 / #1101(PR #1103/#1104 已合并)带证据关闭。
- 卡片:#1047–#1057(11 张,全部为 #1046 的 sub-issue,`ready-for-agent`;blockers 记在各卡 Body 的 Blocked-by 段 + 下方 DAG——本 plan 无原生 GitHub issue-dependency 边,追踪权威是卡体 Blocked-by 清单,由 orchestrator 与本 DAG 保持同步)
- 配套既有票:#1045(残余凭据圈权,收尾)· #1001(cutover 窗口的 auth-roster 侧)· #1004(parent track)

## 一、战役目标(一句话)

把 schema 迁移的执行点从 CI 移进 Cloudflare(migrator worker + 一次性 Atlas 容器,GitHub OIDC 触发),并以此为主线完成 CI secrets 归零:**终局 = GitHub Secrets 只剩 ~7 个部署者身份凭据——无任何 DSN、无运行时 API key、无共享口令、无 Neon 控制面钥匙——且该姿态被契约测试机器守护。**

## 二、DAG 与 frontier

```
无阻塞(初始 frontier,可并行):
  #1047 secrets 卫生(删 9 僵尸 + JWKS/CORS 降 vars)
  #1048 production 运行时 DSN → Secrets Store   ← 最高优先(在修现网最大的洞)
       ⚠️ MED-1:生产侧落地(#1055 同理)以 SAFE-1 重钉为前置(IaC/manifest/Store 可先行;live 生产部署等 owner 重钉,见 §五.4)
  #1049 catalog spikes → 离线 Docker PG
  #1050 migrator 角色 + DSN 入 Store(IaC)

链:
  #1050 → #1051 migrator worker + 容器 + OIDC 触发(staging)
       AC 含 US24 契约(GitHub OIDC 触发 job 在组件部署之前;migrator 无 Atlas 调用/无 DB-cred 引用)
       ⚠️ MED-2:staging/production 用**分离的 migrator worker + DSN**,staging token 物理上够不到 production migrator
  #1051 → #1052 staging 流水线重排(schema before app,删组件 Atlas step)
       AC 含 US24/US25 契约测试(新代码 vs 旧 schema 双向窗口安全)
  #1051 → #1054 staging gate 的 OIDC 通道(删 STAGING_GATE_TOKEN)
  #1051 → #1100 → #1101 connectivity 补丁(Option 1,spec 见 docs/specs/2026-08-16-migrator-neon-connectivity-spec.md)
       ⚠️ **历史记载(2026-08-16 计划,已被 08-20 checkpoint 取代,勿按此再开卡)**:当时把 #1100 写成 IPv4-pin 实现,并写"Option 1 证伪 → 开 Option 2"。08-20 二分证明被证伪的是 pin 本身、不是容器路径;Option 2 降为备胎;unpin + 裸 `stopped` + expected-head 判据的修复卡 = **PR #1109**(分支 `fix/migrator-depin`)。#1100/#1101 已随 PR #1103/#1104 合入并关卡。
       #1100:entrypoint IPv4 pin(hostaddr)+ 拒绝 -pooler + 30s fail-fast status probe(apply 前)
       #1101:sleepAfter 30m + renewActivityTimeout(每 poll)+ stop-on-timeout(释放 max_instances=1 槽位)+ 504 诊断体(ranMs/lastStatus/exitCode)
       触发 staging 仅在 #1100+#1101 均合入后;若 Option 1 证伪 → 开 Option 2(worker 侧 neon-http apply,另行卡)

       ⚠️ MED-2/Seat1(c):#1051 与 #1054 用**各自的固定 audience**,防跨服务 replay
  #1052 → #1055 production 切换(pinned target;前置证据:≥3 次 staging 真实迁移)
       ⚠️ MED-1:生产侧执行以 SAFE-1 重钉为前置(owner 动作)
  #1049 → #1053 Neon 测试基建退役(NEON_API_KEY 清零)
       ⚠️ MED-3:AC 二选一——在 CI 立(或保留)hermetic Docker Postgres Python 集成道(仿 #1049),或在删任何 Neon 测试基建前**显式接受并记录覆盖损失**(pipeline-agent.yml 只跑单测,ci.yml TEST_DB:neon 是唯一 DB 集成道)
  #1050 → #1056 cutover 验证 + 剩余项 + 双钥匙脚本(LOW-1:pulumi-cwd 缺陷 main 已修 67e53dba,不重建)

终局:
  {#1048, #1055, #1056} + 人工 cutover 窗口 → #1057 删尽 NEON_DATABASE_URL + 终局清单核对
       🧩 Seat1(f):#1053 → #1057 新增边——终局验收要求 NEON_API_KEY 清零已随 #1053 落地
```

frontier 规则:blockers 全 CLOSED 即可开卡 —— 开卡条件以各卡 **card-body Blocked-by 段全部 CLOSED** 为判据(原生 issue-dependency API 在此环境中不可用;orchestrator 负责让卡体与本 DAG 保持同步)。

## 三、执行政策(每张卡一致)

1. **Policy C**:代码一律 opencode 写(`ds-flash-max` → `luna-max` 备胎,经唯一 `opencode serve`);Claude 只编排、评审、跑门禁。唯一例外 = owner 当场授权。
2. **门禁**:改动前后各跑一遍 `make check`;跨包契约改动跑全 workspace typecheck。
3. **Quality Ratchet**:每条 AC 已带 test-type(`unit`/`integration`/`api`),PR diff 必须含对应测试(`ac_total == ac_with_test`);Codecov patch ≥95%。
4. **变异验证是唯一的绿灯证明**——契约测试尤甚(把断言目标改坏一处,测试必须变红;作用域要对准被测语句)。
5. **PR 合并**:两路评论闸(`docs/ops/review-gate.md` 单一来源)+ fresh-head + 建 PR 后等 10 分钟 bot 评论,线程逐条 inline 回复后 resolve;卡级终审 = reviewer 席读 diff vs brief。

## 四、止损门(命中即停,回报 owner)

- 任何操作需要 **secrets 明文值** → 停。不需要值就能做的事不要值;值永不进对话。
- **破坏性红线**:cutover 的 rehearsal(#1056)绝不触发 Phase D 及之后;migrator 永不获得 DROP/任意 SQL 能力;production 永不 wipe(SAFE-1)。
- **#1055 前置证据不足**(staging 真实迁移 < 3 次)→ 不得开卡。
- 同一张卡连续 2 轮修复仍红 → 停,升 owner。
- staging 部署链在卡外原因上持续红(如 #1001 记录的 neon-secrets 失败)→ 修复属于对应票,不得在本战役卡里顺手扩权。

## 五、人工节点(owner 动作,agent 不得代办)

1. **cutover 窗口**:#1056 就绪后,由你 dispatch `staging-cutover`(与 #1001 的 auth-roster rebuild 同窗口);执行完成的证据贴到 #1057。⚠️ 到点我们会**醒目提醒你批准**。
2. **production environment approve**:#1048 / #1055 的 production 部署照旧走你的审批门。
3. **spec 双评审**:本 spec(#1046)双席评审已完结(2026-08-16;seat 1 APPROVE-with-findings,seat 2 REJECT amend-and-approve),findings 已全部并入 spec 正文 + 本 goal;frontier 按修订后 DAG 放行。
4. **SAFE-1 重钉(MED-1,新增)**:release-manifest pin(`release-eligibility.sh`/pinned blob)会挡住**所有** campaign 代码的生产部署——#1048/#1055 的生产侧执行必须在 SAFE-1 重钉之后才能实际落地生产部署;该 re-pin 是**你的动作**,IaC/manifest/Store 侧的落地不阻塞、可先行。

## 六、验收总纲(#1057 的最终核对表)

| GitHub Secrets 终局 | 数量 |
|---|---|
| CLOUDFLARE_API_TOKEN / _ACCOUNT_ID / CLOUDFLARE_PULUMI_API_TOKEN | 3 |
| R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / PULUMI_BACKEND_URL / PULUMI_CONFIG_PASSPHRASE | 4 |
| GITHUB_TOKEN(内置,短命,permissions 收紧) | — |
| **DSN / 运行时 API key / 共享口令 / NEON_API_KEY** | **0** |
| ZEN_GO_API_KEY(eval)→ Store/vars(归入 #1057 清单项,非零行) | → Store/vars |
| GITLEAKS_LICENSE(gitleaks 扫描自身的许可证)→ 保留并在清单写一行理由,或显式说明移除 | keep-or-explain |

LOW-4 说明:以上两把被 workflow 引用的 key 原既不在僵尸清单、也不在终局表——现写入终局清单:ZEN_GO_API_KEY 随 Secrets Store 迁移去 CI(计数为 #1057 项);GITLEAKS_LICENSE 保留并给出理由,避免"看起来归零实则仍被引用"的清单失真。终局验收按**完整清单**(~7 + 这两者的处置)计算,而非 ~7 孤证。

之后 #1045 对存留的部署者凭据做最小权限圈定与轮换节奏,战役收官。

## Amendment(2026-08-16 spec 双评审)

dual-seat spec review 完结后,本 goal 随 spec(#1046)并入全部 findings(正文已改,此处为变更摘要):

- **DAG**:新增边 **#1053 → #1057**(Seat1 f,终局验收要求 NEON_API_KEY 清零随 #1053 落地);#1051/#1052 标注 **US24/US25 入卡 AC**(Seat1 b);#1051 标注 **分离的 staging/prod migrator worker + DSN** 与 **#1051/#1054 各自固定 audience**(Seat1 c / MED-2);#1053 标注 **MED-3 AC 二选一**(立/保 hermetic Docker Postgres Python 集成道,或显式接受并记录覆盖损失);#1056 改为 **验证 + 剩余项目 + 双钥匙脚本**(LOW-1,不重建)。
- **§四止损门**:在"production 永不 wipe(SAFE-1)"基础上,新增 **MED-1 关联**——#1048/#1055 生产侧执行以 SAFE-1 重钉为前置。
- **§五人工节点**:新增 **SAFE-1 重钉(owner 动作)**;#1050/#1055 的 IaC/manifest/Store 侧先行;**spec 双评审项更新为已完结**。
- **§六验收总纲**:补 **ZEN_GO_API_KEY / GITLEAKS_LICENSE 两个被引用 key 的处置**(LOW-4),终局清单按完整清单计算;runtime 非 DSN 秘钥(model keys/maps key/observability token/Turnstile/anon-ID)随 spec §US15 计为 **#1057 验收项**(Seat1 a)。
- **PR #1059 评审 finding A/B 已解决**:原生 issue-dependency 边在此环境不可用(POST /issues/{n}/dependencies 404,无 GraphQL mutation),版图以 **card-body Blocked-by + 本 DAG** 为准;**#1053 → #1057** 已记录在 **卡 #1057** 上。
