# S0-v2 GOAL — 验收契约

本文件是 S0-v2 的验收契约:**全部勾选即 S0-v2 关账**,进入 S1 功能线。
判据细则见 `docs/superpowers/specs/2026-08-05-s0v2-launch-spec.md`;勾选必须附证据(run 链接/截图/查询结果)。

## 0. 止血

- [ ] main push 部署链全绿(staging 免挑战规则生效,post-deploy smoke 过)
- [ ] staging IP 闸开启(`stagingGateEnabled=true` + workers_dev 全关);无凭证裸访 403、CI 带 token 通过

## A. 仓库卫生

- [ ] 死物清单(skills-lock/deno.lock/atlas.hcl/CHANGELOG/VERSION/neon 0001 副本/孤儿脚本/spikes)零残留,hygiene 脚本锁定
- [ ] sonar 配置合一且 Quality Gate 仍工作
- [ ] 根目录 tracked 条目 ≤ 25,清单锁进 hygiene 测试
- [ ] 已合并分支全删 + 4 旧 tag 删 + auto-delete-branch 开启

## B. CI/CD(#679 全套)

- [ ] 双 web 车道消灭:同一 PR web 测试只跑一遍;ruleset 换名完成
- [ ] 四个 meta 断言脚本阻塞执行(timeout/permissions/concurrency/merge_group)
- [ ] 九包各一条 pipeline;`changes` job + paths-filter 删除;gate 层删除;ruleset 7→≈26
- [ ] `sha_pinning_required=true`;repo 级 CF token 删除;attestation 上线(build→deploy verify)
- [ ] merge queue 启用(#671 七项检查过)

## C. landing 上生产

- [ ] animichi.com 对外 200;www/旧域名 301;生产审批记录在案
- [ ] prod 纯展示:全部交互点弹「开发中」(截图取证);staging 功能不受影响
- [ ] **像素级视觉回归**:三页(landing 昼/夜、mobile、authenticated home)对 mockup 正典
      `maxDiffPixels ≤ 8` 全绿并入库为回归基线;变异验证(改色→红)通过
- [ ] Lighthouse CI 门上线(LCP/CLS 阈值);IndexNow key + CF beacon + 真 og-image 就位
- [ ] owner manual:GSC/Bing 属性验证 + AI Crawl Control 取证
- [ ] GOAL A 五条验证在 **staging** 全过(匿名聊天/登录/photo-search/cron/healthz)

## D. 测试自动化 + 数据供给

- [ ] Playwright Test Agents 管线落地(`--loop=opencode`);首条 agent 生成用例过全部晋升条件
      (两连绿 + 变异检验 + locator 人读)进正式套件
- [ ] `testIgnore` 防线先于任何生成物存在
- [ ] catalog cron 在 staging 真跑一轮:预收录种子(10-20 作品)入库,`bangumi/points` 行数增长取证
- [ ] `sources.ts` retry/退避生效(429 注入单测)
- [ ] #540 ingest 收口(WorkerEntrypoint)完成
- [ ] #684 MiMo-only 收敛关卡

## F. Agent 体系

- [ ] `.claude/skills/` 无死物;存留 skill 自述与源码一致(复核记录)
- [ ] 4 角色定义重写并与现行政策一致
- [ ] `workflow.md` 单页上线(机器可执行判据)
- [ ] 任务单 schema + `make visual-check` 首个任务原子可参数化调用成功

## G. 命名

- [ ] `docs/naming-conventions.md` 公约入库
- [ ] L1/L2 违例清单归零(每 PR 测试数不变);L3 清单交 owner 裁决记录在案
- [ ] lint 命名规则开启(oxlint/ruff)防回潮

## E. 历史(最后执行)

- [ ] 全量备份可恢复实证(bundle + archive fork)
- [ ] filter-repo 完成:Co-Authored-By 零残留、commit ~30-60、CI/Pulumi/codecov 新 SHA 全绿
- [ ] `includeCoAuthoredBy: false` 生效(新 commit 无尾部)

## 跟踪项(不阻塞关账)

- [ ] Google `site:animichi.com` 收录(发布后一周观察)
- [ ] cfut 旧 token 已 revoke(owner)
- [ ] CF 账号 2FA 确认(owner)
