# 延迟决策登记册(Deferred Decision Registry)

> 所有「等 XX 信号出现再做」的决策集中登记。散落在 SD/X/飞轮条目里的推迟项在此有唯一编号。
> **巡检节拍**:每迭代收尾跑一次「触发器巡检」(见文末巡检指令);信号满足 ≠ 自动执行,一律人拍板(同 SD-22 self-evolve 边界)。
> 初版扫描自 inputs SD-1~27 / X1-X15 / 飞轮手册(2026-07-06);spec 回填阶段复核补全。

## 信号类型

- **内部**:自家埋点/表/trace 可查 —— 巡检时查 Logfire / Neon
- **外部**:生态成熟度 —— 巡检时 WebSearch 核实
- **需求**:用户反馈/商务信号 —— 巡检时查反馈渠道 + 问维护者

## 登记表

| ID | 推迟的事 | 来源 | 触发条件 | 类型 | 数据来源 / 检查方法 | 状态 |
|---|---|---|---|---|---|---|
| DD-1 | Supabase auth 退役、auth 迁 Neon | SD-3⑤ | Neon Auth 成熟(GA + migration 工具稳定) | 外部 | WebSearch "Neon Auth GA changelog" | 冻结 |
| DD-2 | 意图路由层 / plan-and-execute 改造 | SD-7 | eval 调优到天花板仍不达标(IntentMatch 连续 2 迭代无提升且 <85%) | 内部 | eval 八族分数历史(飞轮1 报表) | 冻结 |
| DD-3 | user_memory 唤醒(跨会话个性化) | SD-8/SD-15③/飞轮5 | 飞轮2 分析证明跨会话偏好高频复现(同类偏好 ≥3 会话重现、覆盖 ≥20% 活跃用户) | 内部 | 飞轮2 意图口味埋点聚合(选候选/改配速/删站) | 冻结 |
| DD-4 | 注入隔离 sub-agent | SD-19/SD-24① | 迭代7 评估点 + eval G 族(注入)分数不达标 | 内部 | eval G-1/G-2/G-3 分数 | 冻结(迭代7 评估) |
| DD-5 | Llama Prompt Guard 从标记升级为硬拦 | SD-19 P2 | 告警准确率数据充分(误报率 <5%) | 内部 | 埋点缺口:Prompt Guard 告警 vs 人工判定结果 → **迭代1 埋点清单需补 injection_flag + 人审标注字段** | 冻结 |
| DD-6 | BYOK key 服务端加密存储(跨设备) | SD-20 | 用户明确要求跨设备记 key 的反馈 ≥N 条 | 需求 | 用户反馈渠道 | 冻结 |
| DD-7 | 飞轮3 UGC→catalog 审核管线 | SD-22/23 | catalog_suggestions 表累积量(≥50 条待审) | 内部 | `SELECT count(*) FROM catalog_suggestions` | 冻结(迭代1 只建 schema) |
| DD-8 | mcp-client(消费第三方 MCP) | SD-24② | 真实第三方能力需求出现(某能力自建成本 > 接入成本) | 需求 | 功能 backlog 评审 | 冻结 |
| DD-9 | 运行时 skill 框架(动态工具装卸) | SD-24③ | 工具膨胀到 20+ | 内部 | `grep -c "@agent.tool" agent/agents/` | 冻结(当前 9) |
| DD-10 | A2A server | SD-25③ | 企业编排侧真实信号(合作询盘/生态明确 C 端案例) | 需求+外部 | 反馈渠道 + WebSearch "A2A consumer adoption" | 冻结 |
| DD-11 | 图搜层3:全库跨作品向量搜 | SD-26 | 层1+2 实测失败率可观(layer_hit=none ≥15% 且绝对量 ≥100/周) | 内部 | 图搜埋点 layer_hit 分布(已定义,迭代1 埋) | 冻结 |
| DD-12 | ANN 索引(HNSW / Neon lakebase_ann) | SD-26 | DD-11 立项(依赖)+ lakebase_ann 成熟度 | 内部+外部 | 随 DD-11;WebSearch "Neon lakebase_ann stable" | 冻结 |
| DD-13 | embedding contrastive 微调(配对数据) | SD-26 调研 B 表 | 飞轮3 配对数据量(≥5k 对)+ AB 显示 embedding 粗筛召回是瓶颈 | 内部 | 打卡照-点位配对计数 + 离线 AB 报告 | 冻结 |
| DD-14 | 点位独立页(SEO) | SD-27A | 点位级 UGC 厚度(有対比図/打卡/评论的点位占比 ≥20%) | 内部 | 点位 UGC 覆盖率查询 | 冻结 |
| DD-15 | 语义缓存 | SD-18 排除项 | 成本数据显示高频重复 query 占比可观(≥20% 日请求语义重复) | 内部 | 埋点缺口:query 归一化聚类统计 → 巡检时用 daily_usage + trace 抽样近似 | 冻结 |
| DD-16 | human-in-the-loop 工具审批 | SD-18 排除项 | 出现第一个写副作用工具 | 内部 | 代码评审时人工触发(非埋点) | 冻结 |
| DD-17 | 生产会话抽样评分 | SD-24 默认项 | 运营带宽 + 会话量(≥500 会话/周) | 内部 | daily_usage 会话计数 | 冻结 |
| DD-18 | pydantic-ai v1.69 → v2.x 升级 | 现状(v2.5 已发 VercelAI/AG-UI adapter) | v2 稳定(≥3 个月无破坏性回滚)+ 迁移收益明确(SD-9 adapter 自带) | 外部 | WebSearch "pydantic-ai v2 stability changelog" | 冻结 |
| DD-19 | MCP Apps 扩展(ChatGPT 特有字段等) | SD-13 | 宿主生态出现明确分发收益案例 | 外部 | WebSearch "MCP Apps consumer distribution" | 冻结(迭代7 只做最小子集) |
| DD-20 | kitsunavi.com 品牌升级 | SD-0 备选 | 品牌决策(用户主观) | 需求 | 问维护者 | 冻结 |
| DD-21 | 时刻表级换乘(自托管 OTP+GTFS 或 Jorudan 开放API) | SD-28 层3 | 交通段 👎 计数显著 或 deeplink_clicked CTR 异常高(用户要精确时刻的信号) | 内部 | 埋点 transit_leg_shown / deeplink_clicked(迭代2 随层2 埋)+ 👎微件按卡类型切分 | 冻结 |
| DD-22 | 文本向量检索(UGC RAG / 别名语义召回) | SD-29 | 双触发:① UGC 文本语料 ≥5k 条 → 评估 UGC 混合检索(BGE-M3 类多语言候选);② resolve 失败案例经 eval 判定为"语义模糊型"而非"数据缺失型" → 别名向量辅助召回 | 内部 | UGC 条数计数;eval 八族 resolve 失败案例分类标注 | 冻结 |
| DD-23 | pydantic-evals 迁移(替代手搓 pytest+JSON eval 框架) | SD-30⑨ | 轨迹断言 + bootstrap 统计门控的自建代码规模/维护成本超过阈值(自建 eval 基建 >500 行或维护痛点 ≥2 次/迭代);pydantic-evals 保持 Production/Stable ≥2 个季度 | 内部+外部 | 自建 eval 基建行数 grep;WebSearch "pydantic-evals changelog stability" | 冻结 |
| DD-24 | iter-3/4 四薄点深度细化:① Walk GPS 实时逻辑(到达判定半径/后台省电/漂移防误判)② 打卡防伪造验证 ③ 対比図拍摄对齐 UX ④ 离线打包边界与体积预算 | spec 详细度热力图讨论(2026-07-06 用户批准:留迭代3 开工前,不提前写死) | **迭代3 排期启动前**(流程节点触发,非信号型);⚠️ **飞轮3 上游质量标记**:四点决定打卡数据可信度与回流照片质量 → 图搜 real2real 唯一解锁源(SD-26),细化时须带迭代1-2 实际学习(定位权限授予率等) | 内部(流程) | 迭代3 排期会人工触发;巡检时核对是否已排期 | 冻结(计划内延迟细化) |
| DD-25 | durable execution(Cloudflare Workflows——checkpoint/重放式长任务执行) | agent resume/checkpoint 讨论(2026-07-07):现有 run = 秒级全只读幂等,重跑即恢复,run 级 checkpoint 属过度工程;「领域数据即 checkpoint」原则成立 | **首个长时(>60s)或有写副作用的 agent 任务立项时**(如批量导入/UGC 批处理/付费操作)——重跑策略届时失效,需 durable execution;CF Workflows = 零新供应商现成方案 | 内部(流程) | 新工具/任务设计评审时人工触发;巡检核对有无此类任务进了排期 | 冻结 |

## 埋点缺口汇总(建迭代1 全信号埋点时一并补)

- DD-5:`injection_flag`(Prompt Guard 告警)+ 人审标注回填字段
- DD-11:图搜信号五件套(query_type / gps_available / layer_hit / candidates_shown / user_confirmed)—— SD-26 已定义
- DD-15:query 语义重复度(近似方案:trace 抽样聚类,不单独埋)
- 其余 DD 的内部信号复用已定表(daily_usage / catalog_suggestions / 飞轮2 埋点 / eval 分数历史),无新埋点

## 触发器巡检指令(给 agent)

> 每迭代收尾执行。任何 Claude Code 会话输入:"跑触发器巡检" 即按此执行。

1. 读本文件登记表。
2. **内部**信号:用 Logfire MCP(arbitrary_query)/ Neon MCP(execute_sql)/ 仓库 grep 查每条的「数据来源」,取当前值。
3. **外部**信号:对每条的 WebSearch 关键词派 sonnet 子代理核实(合并为一个代理一次查完)。
4. **需求**信号:列出待问维护者的条目。
5. 产出报告:每条 DD 的 当前值 vs 阈值 → `未满足 / 接近(≥70%) / 已满足`;已满足的附证据与重启评估建议。
6. **不得自动解冻或执行任何 DD**——报告交维护者拍板(SD-22 边界)。
7. 状态变更(解冻/作废/阈值调整)写回本文件并 commit。
