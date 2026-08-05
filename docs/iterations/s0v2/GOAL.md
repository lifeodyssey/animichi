# S0-v2 GOAL — 验收契约

本文件是 S0-v2 的验收契约:**全部勾选即 S0-v2 关账**,进入 S1 功能线。
判据细则见 `docs/superpowers/specs/2026-08-05-s0v2-launch-spec.md`;勾选必须附证据(run 链接/截图/查询结果)。

## 0. 止血

- [ ] main push 部署链全绿(staging 免挑战规则生效,post-deploy smoke 过)
- [ ] staging IP 闸开启(`stagingGateEnabled=true` + workers_dev 全关);无凭证裸访 403、CI 带 token 通过

## A. 仓库卫生

- [ ] 死物清单(skills-lock/deno.lock/atlas.hcl/CHANGELOG/VERSION/neon 0001 副本/孤儿脚本/spikes)零残留,hygiene 脚本锁定
- [ ] sonar 配置合一且 Quality Gate 仍工作
- [ ] 根目录 tracked 条目收敛至显式 allowlist(计数规则随 ticket 定稿)并锁进 hygiene 测试
- [ ] 已合并分支全删 + 4 旧 tag 删 + auto-delete-branch 开启

## B. CI/CD(#679 全套)

- [ ] 双 web 车道消灭:同一 PR web 测试只跑一遍;ruleset 换名完成
- [ ] 四个 meta 断言脚本阻塞执行(timeout/permissions/concurrency/merge_group)
- [ ] 九包各一条 pipeline;`changes` job + paths-filter 删除;gate 层删除;ruleset 7→≈26
- [ ] `sha_pinning_required=true`;repo 级 CF token 删除;attestation 上线——验收为**完整绑定断言**
      (产物 digest==subject、部署版本 metadata==同 digest),非存在性检查
- [ ] merge queue 启用(#671 七项检查过)

## C. landing 上生产

- [ ] animichi.com 对外 200;www/旧域名 301;生产审批记录在案;域名/路由/301 全部 Pulumi 声明(拓扑测试)
- [ ] prod 纯展示:全部交互点弹「开发中」(截图取证);staging 功能不受影响
- [ ] **prod 后端直达拒绝**:绕过 UI 直打 chat/photo-search/API 路径得 403/404(curl 取证)——纯展示不只是 UI 层
- [ ] `VITE_SHOWCASE_MODE` 严格布尔契约:仅 `"true"`/`"false"` 显式等值,其他 fail-closed;
      preflight 允许值校验 + deploy-vite-env 契约测试;staging=false / prod=true 双端部署后 E2E 取证
- [ ] SEO 逐项静态断言全绿:robots/sitemap/canonical/hreflang/JSON-LD/llms.txt/OG+Twitter 完整集(单测)
- [ ] **视觉双层闸五帧收敛**(landing 昼、landing 夜、mobile 390×844、Splash、authenticated home
      〔storageState 注入〕;任何帧移出阻塞集=范围变更,须 owner 显式签核并同步 spec/GOAL):
      ①收敛层:每帧对正典快照的比例阈值棘轮降至收敛线(diff 清单清零记录在案)
      ②回归层:收敛帧升格自身基线,`maxDiffPixels ≤ 个位数` 进 CI 阻塞
      ③变异验证:故意改色 → CI 变红
- [ ] Lighthouse CI 门上线(CLS 阻塞、LCP 预警起步,N 次取中值);IndexNow key + CF beacon + 真 og-image 就位
- [ ] Hero 搜索 query 修复:staging(非 showcase)提交携 `?q=` 跳 chat(E2E 断言);prod 弹「开发中」
- [ ] owner manual:GSC/Bing 属性验证 + AI Crawl Control 取证
- [ ] GOAL A 五条在 **staging** 逐条过,判据:
      ①匿名聊天:Turnstile→限流→配额→容器 SSE 首 token(浏览器取证)
      ②登录:magic link→JWT→edge 验证→用户数据读回(E2E)
      ③photo-search:上传→vision 调用→`daily_usage` 落行(API+DB 查询)
      ④retention cron:Workers Cron 真跑一轮日志取证
      ⑤`/healthz` 200 且 `git_commit` 与部署 SHA 一致(smoke)

## D. 测试自动化 + 数据供给

- [ ] Playwright Test Agents 管线落地(`--loop=opencode`);首条 agent 生成用例过全部晋升条件
      (两连绿 + 变异检验 + locator 人读)进正式套件
- [ ] `testIgnore` 防线先于任何生成物存在;CI 护栏断言 PR diff 不含未晋升生成物
- [ ] **数据供给三阶段门(有序,后一阶段以前一阶段证据为前置)**〔席 B ④〕:
      ①ingest 收口(#540):外部直调 ingest 路径不可达取证(oRPC router 无公网 handler)
      ②抓取韧性:429/5xx 有界指数退避 + Retry-After/批间隔,假时钟单测全绿
      ③cron 启用:`[triggers]` 配置仅在 ①② 证据在案后允许合入;staging 真跑一轮,
        种子(10-20 作品)入库、`bangumi/points` 行数增长取证;礼貌约束(限速/UA/单飞)断言在案
- [ ] #684 MiMo-only 收敛关卡(停用 provider 键 grep 零出现)

## F. Agent 体系

- [ ] repo 级 `.claude/skills/`(4 个 tracked)自述与源码一致(复核记录);user 级(~/.claude)
      Vercel 系/过时 skill 清理列 manual-ops 完成
- [ ] 4 角色定义重写并与现行政策一致
- [ ] `docs/workflow.md` 单页上线(机器可执行判据;AGENTS.md 一行指针,不进 .claude/rules)
- [ ] 任务单 schema + `make visual-check` 首个任务原子可参数化调用成功

## G. 命名

- [ ] `docs/naming-conventions.md` 公约入库
- [ ] L1/L2 违例清单归零(每 PR 测试数不变);L3 清单交 owner 裁决记录在案
- [ ] lint 命名规则防回潮开启(Python=ruff N 系列;TS 按工具实测能力配置)

## H. 代码结构收口(owner 终核纳入;与 G 同波)

- [ ] #651:agent 迁入 `src/` 布局,全部工具链(uv/pytest/ruff/CI)随迁,测试数不变
- [ ] #654:DatabasePort 协议 + SessionEnvelope 封套落地,dict 混装消灭(typecheck 锁)
- [ ] #655:存量破线文件拆分归零 → 1-10-50 lint 全线阻塞开启

## I. Auth cutover(owner 终核纳入)

- [ ] staging:NEON_AUTH_ENABLED 翻转,GOAL A ②登录判据改走 Neon Auth 全链取证
- [ ] local-dev/E2E auth 依赖迁移:`make dev-local` / `make e2e` 一条命令仍绿
- [ ] prod 翻转(随 C 的生产发布窗口或其后,owner 批)
- [ ] Supabase 面退役:config/functions/templates/migrations 清出,残留引用 grep 归零

## E. 历史(最后执行)

- [ ] 全量备份可恢复实证(bundle + archive fork)
- [ ] 技术性封窗:Actions/merge queue 暂停记录在案(非口头约定)
- [ ] 全 refs 裁决:`git for-each-ref` 枚举 heads/tags/remote/stash 逐一处置;
      **保留分支(backend-survey 等)同步重写 force-push**——旧历史不得经仓库自身任何 ref 可达
      (GitHub 平台侧 refs/pull 除外,见 spec Out of Scope「表述性清洗」条)
- [ ] filter-repo 完成,**双面断言**:`git ls-remote --heads --tags origin`(服务端权威,显式限定命名空间)
      与允许集合精确相等;允许集合内遍历 trailer 零残留、commit ~30-60
- [ ] 重建收尾:ruleset 重建→Actions 恢复→codecov 基线重置→文档 commit 链接修复→
      worktree 重建→**hooks 重装自测**→CI/部署/覆盖率新 SHA 全绿
- [ ] `includeCoAuthoredBy: false` 生效(新 commit 无尾部)

## 文档交付

- [ ] `docs/ops/integration.md`(env/secrets 三级分布、域名拓扑、数据链路、部署链、本地开发)与 spec 同 PR 落库

## 跟踪项(不阻塞关账)

- [ ] Google `site:animichi.com` 收录(发布后一周观察)
- [ ] cfut 旧 token 已 revoke(owner)
- [ ] CF 账号 2FA 确认(owner)
