# 清扫战役计划(iter6)— 2026-08-03

来源:四路并行评审(结构 / TS / Python / S0 符合性)+ MiMo 视觉实测。
状态:**APPROVED — owner 两轮 grill 定稿 2026-08-03**。
配套盘点:[status-2026-08-03-s0-audit.md](./status-2026-08-03-s0-audit.md)

## Owner 决策记录(grill 定稿)

1. **iter 组织**:独立 **iter6=cleanup** 战役式执行;"现在做不了或收益不大"的项分流到对应 S 线,不占 iter6。
2. **vision 供给**:**彻底简化——vision 入主 agent 多模态输入**(MiMo 实测支持 image_url)。砍掉独立供给层(gemini_vision.py + vision_supply_router + GEMINI_API_KEY 面);需重评 SD-26,设计卡 + eval 卡放对应 S 线(photo-search phase 2,#255 S4.8 前置)。
3. **结构迁移(C1/C2)**:staging 全绿后、A 组删除之后做。
4. **1-10-50 lint**:按现规约(源 300/测试 200)全线强制,**存量破线文件全部拆完**——但拆分必须认真做重构设计(设计模式/最佳实践),方案先与 owner 讨论再执行,不搞机械拆分。
5. **docs 瘦身**:**filter-repo 彻底重写历史**,接受 SHA 变更/重 clone 代价。
6. **staging 卡点**:operator 并行处理(VITE 变量 + CF token + DNS + 凭证轮换),与本战役互不阻塞。

## 拟开 issue 清单(草案,待 grill 后定稿)

### A. 立即可做(纯删除/纯文档,零行为变化)
| # | 内容 | 来源 |
|---|---|---|
| A1 | 修根 AGENTS.md:删 frontend/ 幽灵条目(覆盖率/ESLint 条款) | 结构 P0-1 |
| A2 | 提交两份 untracked 活 spec(cicd-rebuild、catalog-rpc);删根 handoff 副本与 stub | 结构 P0-4/P1-7 |
| A3 | Python 死代码批删:session_facade 死功能 130 行 + AgentResult.tool_state legacy dict + settings 15 死字段 + create_agent + 死 SDK 文件 + Protocol 3 死方法(净删 600+ 行) | Py #1/2/4/8/11/12 |
| A4 | ManagedPrompt 远端死扩展点拆除(~200 行,逻辑上永不生效) | Py #3 |
| A5 | 关僵尸卡 #231/#246/#248/#263 + 删 codex/s0-* 等已等价合并分支 | 盘点 |
| A6 | docs 归档:specs/plans 批量入 archive、死文档删除、TODOS 并入 task_plan | 结构 P1-5/6/8 |

### B. 小改动(行为等价重构/一致性)
| # | 内容 | 来源 |
|---|---|---|
| B1 | web 配额信封解析改走契约包 AnonLimitErrorEnvelope(现零引用,注释失实) | TS #1 |
| B2 | chat.py 手写 body 解析 → pydantic ChatBody 模型(~100 行→模型声明) | Py #7 |
| B3 | 异常→响应映射表驱动化(现三处同步) | Py #6 |
| B4 | catalog search.ts 裸 as 收窄对齐 resolve.ts 纪律;narrow 函数提公共 | TS #4 |
| B5 | authSession 硬编码 15min TTL → 读 JWT exp;评估 better-auth jwtClient | TS #6 |
| B6 | pmtiles 租约状态机 80 行 → 10 行惰性注册 | TS #3 |
| B7 | pickNext 双打平规则二选一(改前跑全量 query 差分) | TS #5 |
| B8 | gemini_vision REST 手写 → google-genai SDK 或独立小 Agent(顺带解 #518 文案区分) | Py 评审+实测 |
| B9 | Turnstile header/窗口常量入契约包;EdDSA 校验两处提公共 | TS #7/#9 |

### C. 结构迁移(大 diff、纯机械、需独立窗口)
| # | 内容 | 来源 |
|---|---|---|
| C1 | apps/agent → src/animichi 布局 + 包名对齐;双 tests/scripts 归一;spikes 出包;application/tools 目录正名 | 结构+讨论 |
| C2 | worker/ → workers/edge/ + src/test 分层 + app.ts 拆分 | 结构+TS #2 |
| C3 | docs 57MB 二进制移出 git;深嵌套归档压平 | 结构 P0-2/P2 |
| C4 | 类型收敛:db reflection DI → DatabasePort Protocol;session 信封 → SessionEnvelope 模型 | Py #9/10 |

### D. 决策依赖(先 grill / 先 eval)
| # | 内容 | 依赖 |
|---|---|---|
| D1 | vision 供应商对比 eval(MiMo vs gemini-flash 认番剧命中率) | 决策 2 |
| D2 | 1-10-50 规约:补 worker/catalog lint 强制 或 修订规约 | 决策 6 |
| D3 | logfire _internal scrubbing 耦合:启动断言 + 版本区间锁 | Py #14 |

## S0 符合性核验结果(2026-08-03 第四路报告)

**可安全关闭**:#231(S0.2)、#263(S0.10)、#248(S0.7)。已关的 #228、#244 复核无误。
**可关但注记取代**:#234(tag-deploy→push-main+手动 dispatch;NextHandler 层随 #537 消亡)、
#246(Supabase→Neon Auth = SD-31 决策;两条 browser AC 实际只有 unit 覆盖)。

**不能关(完成是虚的)**:
- **#262 S0.9 最虚**:5 条 AC 只实 2 条,且都是 #274/迁移边界工作顺带兑现;缺:Next.js 零残留 hygiene 守卫、testing-strategy.md 覆盖率段重写(仍写着 "Frontend tests ❌ None")、D7 "both REJECTED" 段落+断言。
- **#237 S0.4**:实现齐但 3 条 browser AC 的 e2e 全缺;**3s 首瓦片测量全仓不存在**,`test:perf-mobile-cold` 脚本名义存在但只跑 splash——命名误导。
- **#252 S0.8**:测试套件质量高,但缺 4 件:IndexNow key 文件、旧域名 301 Worker 规则、Lighthouse CI 门、CANONICAL_DOMAIN 硬编码(有注释论证,待裁决);3 条 manual-ops 零证据需 owner 亲验。

**测试诚实度**:未发现造假;splash 800ms(CDP 节流真测)、token 漂移 fixture、migrationBoundary(连 CI 命令文本都断言)是真守卫。两处名不副实:`test:perf-mobile-cold` 命名、S0.4/S0.6 的 browser AC 用 unit 顶替(test-type 契约失守)。

### E. S0 缺口回填(新增拟开卡)
| # | 内容 | 来源 |
|---|---|---|
| E1 | S0.9 真·完成:hygiene 守卫脚本 + testing-strategy 覆盖率段重写 + D7 REJECTED 段落 | #262 |
| E2 | map-spike browser specs:3s 首瓦片(真 perf-mobile-cold)+ 越界空瓦片 + R2 故障降级插画;修 `test:perf-mobile-cold` 命名 | #237 |
| E3 | S0.8 代码缺件:IndexNow key + Lighthouse CI 门 + CANONICAL_DOMAIN 裁决(301 规则并入 #545) | #252 |
| E4 | 关卡执行:#231/#248/#263 直关;#234/#246 附取代注记关闭;#237/#252/#262 改挂 E 卡后保持开放 | 汇总 |

## 定稿分配(wave 图)

**iter6 Wave 1 — 纯删除/文档/关卡(无依赖,可并行)**
A1 AGENTS.md 幽灵条目 · A2 untracked spec 提交+stub 清理 · A3 Python 死代码批删 ·
A4 ManagedPrompt 拆除 · A5 关僵尸卡+删分支(含 E4 注记关闭 #234/#246)· A6 docs 归档

**iter6 Wave 2 — 小重构(Wave 1 后)**
B1 配额信封走契约包 · B2 ChatBody 模型 · B3 错误映射表驱动 · B4 search.ts 收窄 ·
B5 JWT exp TTL · B6 pmtiles 简化 · B9 Turnstile 常量入契约 · D3 logfire 断言 ·
E1 S0.9 真完成 · E2 map browser specs(含 test:perf-mobile-cold 正名)

**iter6 Wave 3 — 结构迁移(staging 绿后)**
C1 src/animichi 迁移 · C2 workers/edge + app.ts 拆分(方案先议)· C3 docs filter-repo 瘦身 ·
C4 类型收敛(DatabasePort + SessionEnvelope)· L1 lint 全线强制 + 存量测试拆分(方案先议)

**分流到 S 线(不占 iter6)**
- V1 vision 入主 agent 重设计(重评 SD-26)+ V2 MiMo vs Gemini 认番 eval → **S4.8(#255)前置**,关联 #446/#517/#518/#556
- B7 pickNext 打平规则收敛(需全量差分)→ **S2 route 线(#264 前置)**
- E3 IndexNow/Lighthouse/CANONICAL 裁决 → **S0.8(#252)自身**,随 post-production 窗口

## 执行原则
- 每卡零混入:纯删除卡不带重构,重构卡不带行为变化,C 类迁移不与任何功能同卡。
- C2/L1 的拆分方案、C4 的类型设计:先出设计短文与 owner 讨论,批准后执行。
- B7/C4 等触内核的改动,改前跑对应差分/门禁基线。
- staging 卡点与本战役并行,互不阻塞。
