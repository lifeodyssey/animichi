# Loop Engineering 整备计划(待 review,未执行)

> 2026-07-07。目标:让 Claude Code 环境支撑无人值守/低干预的迭代循环(loop engineering)。
> 来源:两轮扫描(loop 就绪性体检 · Fable / skill+MCP 深扫 · Fable)+ loop engineering 新词调研(sonnet)。
> **本文档所有命令均未执行,待用户逐批批准。**

## 0. 数字总账

| 项 | 现状 → 目标 | 每 session 节省 |
|---|---|---|
| Skill 注入 | ~377 → ~92 | ~8k tokens |
| MCP server | 19 → 7 | ~3.5k tokens |
| Agent 类型(claude-flow 残留) | 65 → 0 | ~3.5k tokens |
| **合计** | | **~15k tokens ≈ 当前系统注入的 60%** |

## 1. ⚠️ 密钥警报(执行任何放权前先处理)

| 位置 | 内容 | 动作 |
|---|---|---|
| `.claude/settings.local.json` | 27 条 allow 条目内嵌明文 key(DeepSeek ×2 / univibe / Supabase Bearer) | 删条目(并入权限重建)+ **用户轮换 key** |
| `~/.claude.json`(项目段 exa args) | EXA_API_KEY 明文 | 删 server(重复)+ **轮换** |
| `.mcp.json` | SUPABASE_ACCESS_TOKEN 明文 | 改 `${SUPABASE_ACCESS_TOKEN}` env 引用 + **轮换** |

## 2. 背景:loop engineering(2026-06,Addy Osmani / Boris Cherny)

定义:"Loop engineering is replacing yourself as the person who prompts the agent. You design the system that does it instead."(演进:prompt → context → harness → **loop**)

六构件 × 本环境现状:

| 构件 | 现状 | 判定 |
|---|---|---|
| Automations(定时发现/分诊) | DD 巡检、飞轮周任务已设计,**全部手动触发** | ⚠️ 唯一结构性缺口 |
| Worktrees | 重度使用 | ✅(30+ 旧的待清) |
| Skills | 齐备 | ✅(路由歧义税,见 §5) |
| Plugins/MCP | 19 server | ⚠️ 过量 |
| Sub-agents(maker/checker) | 4 角色 harness + 双盲评审 | ✅ 教科书级 |
| State(durable spine) | inputs/底档/DD 登记册 + 即时 commit | ✅ 教科书级 |

反模式对照:verification abdication → 被 Ratchet/eval gate 防住;cognitive surrender → 被 SD-22 人在环防住;**comprehension debt → 真实风险**(产出速度 > 理解带宽,靠热力图/详细度分级偿还)。Ronacher 边界:loop 适合可机械验证的工作(回填/翻译/卫生批),长活核心代码保持人主导。

## 3. 体检表(loop 视角)

| 维度 | 现状 | 风险 |
|---|---|---|
| 权限打断 | 项目 926 条 allow(86.6KB)但**缺 `pnpm:*`**(rebuild 即 pnpm monorepo)、curl/mkdir/kill/lsof/git worktree | 高:第一圈卡死点 |
| Harness 过期 | executor/reviewer/tester 定义写死 `backend/` 旧路径;model 三方矛盾(dispatch=sonnet / 描述=Codex / 实际偏好=opus·fable) | 高:executor 首命令即 fail |
| 上下文税 | 390+ skill 条目 + 16 MCP + claude-flow 65 agent 残留 + CLAUDE.md 链 ~28K | 高 |
| Hook 税 | claude-mem PostToolUse `*` timeout 120s(每次工具调用后 spawn login shell);PreToolUse(Bash) 串 3 hook | 高:loop 每步都交 |
| 路由歧义 | design 15+ / planning 6+ / review 7+ / 记忆 3 套;brainstorming 等**交互式 skill 会挂死无人值守 loop** | 高 |
| 风格冲突 | ponytail full(全局)vs Explanatory(项目)反向拉扯;rtk 曾 SIGPIPE | 中 |
| 状态断点 | 工具齐(handoff/checkpoint/planning-with-files/ralph-loop)但无单一协议;session limit 实撞过 | 中 |
| 卫生 | 30 worktree(7 个已 merge)、20 条僵尸分支、plugins cache 残留、settings.bak ×5 | 低-中 |

## 4. Actionable Items(16 条)

### P0 — loop 前必做
1. 权限表重建:926 → ~30 条泛化(`/fewer-permission-prompts`),**先删 27 条含 key 条目**(→ §1 轮换)
2. 补 loop 命令面:allow += `Bash(pnpm:*)` `Bash(curl -s:*)` `Bash(mkdir:*)` `Bash(kill:*)` `Bash(lsof:*)` `Bash(git worktree:*)` `Bash(docker:*)`
3. 4 角色定义更新:backend/ → apps/ 新结构;make 目标核对;**model 统一(用户定:sonnet/opus/fable 三选一写死)**
4. 摘除 claude-flow 残留(65 agent md + 66 command + enabledMcpjsonServers 死引用)
5. 交互式 skill 豁免写进 loop driver prompt(清单见 §7)
6. loop 期间 `claude plugin disable claude-mem`(120s PostToolUse hook 为最大单一延迟源;记忆统一 auto-memory + planning-with-files)
7. 风格二选一:推荐留 ponytail(loop 省 token),项目 outputStyle 改回 default

### P1 — 强烈建议
8. 清 worktree:7 个已 merge 的 `git worktree remove` + `git branch -d`;iter15/* 6 个确认后同理
9. MCP 减负 19→7(判定表见 §6)
10. `.mcp.json` token 改 env 引用 + 轮换
11. rtk hook 容错确认(SIGPIPE 时须 non-blocking,否则 loop 期间摘除)
12. 清 plugins cache(10 个 temp_git_* + claude-mem 旧 8 版)
13. skill 域裁剪(判定见 §5)
### P2 — 可选
14. 清 settings.json.bak ×5、security_warnings ×15、blocklist test 条目
15. 断点协议成文:ralph-loop 驱动 + planning-with-files 三文件为唯一状态源 + 每 story 一 commit(PR 为恢复锚点)
16. deny 加固:`git push --force`、`gh pr merge`(留人工关卡)

## 5. Skill 判定(377 → 92)

**KEEP 全局 ~55**:gstack 工作流全套(browse/investigate/ship/qa/review/health/retro/checkpoint/context-save…)、iteration-planning/execution、plannotator(loop 内 auto-approve)、impeccable 套件 21、tdd、frontend-design、deai-imagegen、raster-to-svg、find-skills、write-a-skill;plugin 留:superpowers(交互件豁免)、ralph-loop+loop+schedule、planning-with-files、claude-mem、codex、cloudflare、hookify、code-review、code-simplifier、typescript-lsp、ponytail。

**PROJECT-ONLY ~20(挪项目 .claude/skills/)**:neon/postgres 系 5、pgvector、fastapi、ai-sdk、r2-image-upload、tailwind-design-system/design-tokens/shadcn/css-audit、next-best-practices、supabase 系;claude-seo 全套(28+20)→ plugin 全局 disable,SEO 迭代临时启用。

**DISABLE ~95**:claude-flow 全家(66 command+65 agent,纯删)、design 竞争者 29(superdesign/design-lab/design-shotgun/ui-ux-pro-max/hallmark/…)、重复工作流(refactoring×5/clean-code×5/diagnose/triage/land-and-deploy/autoplan/plan-tune/…)、grill-me 系(交互式)、chrome-devtools/serena/greptile/supabase/feature-dev/context7/swift-lsp plugin。

**ARCHIVE ~40(删 symlink,源留 ~/.agents/skills 池)**:baoyu×24、redbook、my-voice、de-ai 系、good-writing、kotlin×4、terraform、timescale×3、ppt/docx/xlsx/pdf 系、brandkit。

**触发钦定矩阵**:

| 高危域 | 钦定 |
|---|---|
| 设计页面 | impeccable(审美)+ frontend-design(实现) |
| 做计划 | iteration-planning;轻量单任务 planning-with-files:plan |
| review 代码 | /review(gstack);GitHub PR 用 built-in code-review |
| debug | /investigate;卡死升级 codex:rescue |
| 生成图 | deai-imagegen(走 codex:imagegen 管线) |

**交互式豁免清单(loop prompt 固定条款)**:brainstorming、using-superpowers、grill-me、grill-with-docs、office-hours、plannotator(改 auto-approve)、design-consultation、shape、claude-mem:babysit。

## 6. MCP 判定(19 → 7)

| Server | 判定 | 理由/命令 |
|---|---|---|
| codegraph | KEEP-global | CLAUDE.md 有使用规范 |
| Neon(全局) | KEEP-global | 数据平台核心 |
| logfire | KEEP-project(修) | 生产观测;pin 版本修断连 |
| codex-plugin-cc | KEEP-project | rescue/imagegen 依赖 |
| supabase-seichijunrei | KEEP-project ⚠️ | token 改 env + 轮换 |
| cloudflare-docs / cloudflare-api | KEEP | 主栈文档/API |
| claude-mem mcp-search | KEEP(plugin 内建) | 跨会话记忆 |
| neon(项目小写)/ exa ×2 / sentrux / headroom / microsandbox(118 工具) | REMOVE | 重复/闲置/最大 token 源;`claude mcp remove …` |
| cloudflare-bindings/builds/observability | REMOVE ×3 | 未认证空壳 |
| chrome-devtools / serena | REMOVE(disable plugin) | CLAUDE.md 明令 /browse;serena 断连+与 codegraph 重叠 |
| computer-use | 降级 | loop 不点桌面,按需开 |
| claude-flow / ruv-swarm 残留引用 | 清空 | enabledMcpjsonServers |

## 7. 执行计划(三批,全部待批)

**第一批 · 零风险纯删**(symlink/残留,池子可回滚):claude-flow commands 11 目录 + 3 文件、agents 16 目录、ARCHIVE 组 40 个 symlink。
**第二批 · 需确认**(改配置/含密钥):DISABLE 组 symlink ~70、8 个 plugin disable、MCP 六连删、密钥三处轮换、PROJECT-ONLY 20 个迁移、权限表重建、4 角色定义更新。
**第三批 · loop 启动时**:microsandbox/exa 按需临时挂、claude-seo SEO 迭代临时开、loop prompt 豁免条款、claude-mem 临时 disable、风格切换。
(完整命令清单见深扫报告原文;执行时逐条对照。)

## 8. 附带发现

- 项目根 60+ 张 QA 截图未入 gitignore(git status 噪音)
- `.claude-flow/` `.ruflo/` `.clone/` `.codex/` 项目根残留目录
- code-review plugin 被 marketplace 标记 "just-a-test"(仍可用,知情)
- worker 测试基线实测 16 例(文档旧值 15 已纠)

## 9. 与产品侧的呼应

- Animichi agent 的 resume/checkpoint:会话级 resume 有(続きから/GET 兜底/归属迁移),run 级 checkpoint 有意不做(秒级只读幂等,重跑即恢复;「领域数据即 checkpoint」);长任务出现时 → DD-25(CF Workflows)。
- 开发侧四层 checkpoint:git 即时 commit / 底档双文件 / handoff skill / harness 原生 rewind——loop 断点续跑的地基已在。
