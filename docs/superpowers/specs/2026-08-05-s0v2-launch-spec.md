# S0-v2 Launch Spec — animichi.com 上线 + 全基座收口

- 状态:**DRAFT v2**(to-spec 模板重写;席 A(Fable)首轮 15 条 findings 已全数裁决入文;待席 B(Codex GPT Sol xhigh)+ 席 A 复核 + owner 签核)
- 日期:2026-08-05
- 验收契约:`docs/iterations/s0v2/GOAL.md`(勾完即关账;每勾附证据)
- 评审规约:spec 双席 = **Fable + Codex GPT Sol(effort xhigh)**;调研 sub agent 默认 sonnet/haiku
- 执行规约:代码变更一律 opencode(`opencode-go/deepseek-v4-flash --variant max`,备胎 `gpt-5.6-luna --variant max`);每轮任务提前设计好路径、最大并发派发;执行者绿灯不采信,验收方亲跑门禁 + 变异检验

## Problem Statement

我(owner,solo 开发者)有一个已经在 staging 上完整跑通的产品(动画圣地巡礼搜索与路线规划),但对外世界看不到它:域名从未上线,搜索引擎与 AI 引擎里没有任何痕迹。同时,支撑后续功能开发(S1+)的地基有八处明显欠账——CI 有重复车道与没删干净的过渡态、测试全靠手写、UI 没有任何客观的视觉质量闸、数据库近乎空库(没有自动抓取)、agent 协作体系的定义停留在三代前的政策、命名风格全仓不一致、仓库里堆着死文件、git 历史被 1707 个碎 commit 和 1684 条 AI 署名污染。如果先冲功能,这些债会摊进之后每一张卡;如果不上线,一切改进都没有对外的锚点。

## Solution

把 S0 重新定义为「上线 + 地基」双目标一次收口:animichi.com 以**纯展示 landing**(与设计稿像素级一致、所有交互点弹出「开发中」提示、SEO/GEO 完整)对外上线;同时把八项地基各自修到「有机器判定的验收线」:CI/CD 完成 #679 全套形态、测试引入 Playwright 官方 Test Agents 管线(agent 巡检→人审→生成→变异检验晋升)、视觉质量用双层截图比对闸住、catalog 数据平台加上定时预收录与刷新、agent 协作体系(skills/角色/工作流/任务单)按现行政策重写、全仓命名按公约分级治理、仓库死物清空、git 历史压缩重写并去署名。spec 审定后拆 ticket,由 opencode 满负荷并行执行,我(Claude)只做任务书、验收与门禁。

## User Stories

### 对外上线(访客与引擎)

1. As a 动画爱好者(访客), I want 在浏览器输入 animichi.com 看到完整的 landing 页面, so that 我不需要任何邀请或内部链接就能了解这个产品。
2. As a 访客, I want landing 的观感与官方设计稿完全一致(桌面昼/夜、移动端), so that 我对产品质量的第一印象是可信的。
3. As a 访客, I want 点击任何尚未开放的功能(搜索提交、示例 chips、登录、移动端 CTA)时得到一个设计精致的「开发中」提示, so that 我明确知道产品状态而不是遭遇报错或死链。
4. As a 访客, I want 在移动端(≤640px)也能看到与移动设计稿一致的完整页面, so that 手机分享链接打开时体验不打折。
5. As a 访客, I want 页面在昼/夜模式切换下都正确渲染, so that 我的系统主题偏好被尊重。
6. As a 搜索引擎爬虫, I want 拿到正确的 robots.txt、sitemap.xml、canonical、hreflang(ja/zh/en/x-default)与结构化数据, so that animichi.com 能被正确索引与归因。
7. As an AI 引擎爬虫(被 robots 允许的那些), I want 读到 llms.txt 与可引用的页面内容, so that AI 搜索能正确介绍这个产品。
8. As a 社交平台的分享卡片渲染器, I want 拿到真实的 og-image 与完整 OG/Twitter 元数据, so that 分享链接展示体面。
9. As a 旧域名(aninavi.app 等)的到访者, I want 被 301 到 animichi.com, so that 历史链接不死。
10. As the owner, I want www 与 apex 的重定向、staging 与 prod 的域名拓扑都由 IaC 声明, so that 域名状态可审计、可回滚。
11. As the owner, I want 生产发布走既有的 production approval 关卡并在发布前被醒目提醒, so that 对外可见的变更永远有人签核。
12. As the owner, I want prod 上除 landing 外不暴露任何后端能力(chat/photo-search 不可达或弹提示), so that 上线不引入新的滥用面与模型成本。

### 部署与在场稳定(Track 0)

13. As a developer, I want main 每次 push 的部署链(含 post-deploy smoke)稳定全绿, so that 部署红灯永远意味着真问题而不是环境噪音。
14. As the CI smoke suite, I want 访问 staging 域名时不被 Cloudflare 的浏览器挑战拦截, so that 冒烟判定反映应用本身。
15. As the owner, I want staging 只对我的 IP 白名单与持凭证的 CI 开放(闸门开启、workers.dev 关闭), so that 未发布的功能面不对公网暴露。

### 仓库卫生(Track A)

16. As a developer, I want 仓库根目录只保留有真实消费者的目录与配置(有 allowlist 测试锁定), so that 新来的人(或 agent)不会被死文件误导。
17. As a developer, I want 已合并的远端分支自动删除、历史遗留分支与旧 tag 清空, so that 分支列表反映正在进行的工作。
18. As a developer, I want Sonar 配置只有一份且仍在 PR 上产出 Quality Gate, so that 双份配置不再分叉。

### CI/CD(Track B,#679 全套)

19. As a developer, I want 每个包(agent/catalog/users/edge/web/infra/contract/e2e/quality)有一条独立的 pipeline, so that 任何一次改动只跑相关的检查、失败一眼定位到包。
20. As a developer, I want web 的检查在同一个 PR 上只跑一遍(双车道消灭、ruleset 换名完成), so that CI 时长与报告数量减半。
21. As a developer, I want 四条 meta 断言(每 job 有 timeout、每 workflow 有顶层 permissions、每 pipeline 有 concurrency、每 pipeline 响应 merge_group)作为阻塞检查, so that 流水线的结构性约定不靠人肉记忆。
22. As the owner, I want SHA pinning 强制开启、CF 凭证只存在于 environment 级, so that 供应链与凭证面最小化。
23. As a deploy job, I want 部署的产物带构建出处证明(attestation)并在部署侧校验, so that 部署的东西可证明来自本仓库的构建。
24. As a developer, I want merge queue 启用(前置检查逐项确认), so that 串行合并不再互相打架(BEHIND→update→re-review 的税消失)。
25. As a developer, I want 动 ruleset 的每一步都先存档当前配置且用并集法过渡, so that 必需检查永远不出现「Pending 卡死」空窗。

### 视觉质量闸(Track C 核心)

26. As the owner, I want 设计稿 mockup(经剥离开发态 chrome 后冻结的「正典快照」)成为唯一视觉基准, so that 「和设计稿一模一样」有客观物证而不是感觉。
27. As the owner, I want 实现与正典快照在同一容器镜像、同 viewport、同自托管字体下比对,收敛期用比例阈值棘轮向下、逐差修复到收敛, so that 差异是可枚举、可派单、可清零的工作项。
28. As a developer, I want 收敛完成的帧升格为回归基线并以严格阈值(≤个位数像素)进 CI 阻塞, so that 之后任何 UI 改动的视觉回退当场变红。
29. As a developer, I want 视觉比对是一条可重入的参数化命令(页面/viewport/模式为入参、退出码为判定), so that 它能被 opencode 反复调用,也能被未来的编排层自动派发。
30. As the owner, I want 已登录首页帧有明确的会话注入方案(测试态 storageState), so that 该帧的比对不依赖真实登录链路。

### 性能与观测(Track C)

31. As a 访客, I want landing 的 LCP/CLS 达标, so that 页面不只是像素对,还快。
32. As a developer, I want Lighthouse 检查以抗抖动的方式进 CI(多次取中值;CLS 阻塞、LCP 预警起步), so that 性能门不产生假红。
33. As the owner, I want Cloudflare Web Analytics beacon 上线, so that 上线后第一天就有真实访问数据。

### 测试自动化(Track D)

34. As the owner, I want agent 在 staging 上自主巡检(探索页面、发现问题、产出结构化测试计划), so that QA 不再完全依赖我手动指挥。
35. As a developer, I want agent 的探索产物先落草稿区、经人审后由官方 Generator 转成 Playwright 代码, so that 未审的生成物永远进不了门禁套件。
36. As a developer, I want 生成用例晋升正式套件的条件是机器可判定的(两次连跑全绿 + 变异检验 + 无时序断言), so that 「测试是绿的」不再可能因错误原因成立。
37. As a developer, I want Healer 只在本地产 diff、CI 有护栏断言未晋升产物不进套件, so that 「自动修测试」不会演化成「篡改测试保绿」。
38. As the owner, I want 无视觉能力的执行者(opencode)通过 accessibility-tree 通道完成巡检, so that 巡检不依赖昂贵或不可用的视觉模型;需要视觉判断时才用有视觉的后备(Codex)。

### 数据供给(Track D)

39. As a 访客(未来功能开放后), I want 搜索热门作品时立即命中已收录数据, so that 首次搜索不用等实时抓取。
40. As the owner, I want 一份预收录种子清单(10-20 部作品)由定时任务自动灌入 staging 与 prod, so that 库不再是空的。
41. As the owner, I want 已收录作品按 TTL 由定时任务刷新, so that 上游(Anitabi/Bangumi)的更新会传导进来。
42. As the catalog Worker, I want 对上游的抓取带重试与指数退避, so that 批量任务遇到 429/5xx 不会把整批打进负缓存。
43. As the owner, I want ingest 入口先收口为内部调用(不可被注入的 agent 触发), so that 自动化不放大已知的注入风险面。
44. As the owner, I want 抓取遵守上游的礼貌约定(限速、UA、单飞), so that 我们不是坏邻居。
44a. As the owner, I want 模型密钥收敛到 MiMo-only(停用 provider 的键从部署配置与文档中消失), so that 密钥面与文档不再指向死配置。
44b. As the owner, I want IndexNow key 上线并在发布时提交, so that 新站的收录不完全被动等爬。

### Agent 协作体系(Track F)

45. As the owner, I want `.claude/skills/` 里只有与现行技术栈和政策一致的 skill(死的删、过时的改), so that agent 读到的自述永远可信(陈旧自述骗过评审席的事故不再发生)。
46. As the owner, I want 四个角色(planner/executor/reviewer/tester)的定义重写为现行政策(opencode 执行、双席评审、Test Agents 测试、模型派工表), so that 任何一次派工的口径都有据可查。
47. As the owner, I want 现行事实工作流(grilling→spec→tickets→执行→双评审→变异→两路评论闸→合并)固化为一页机器可判据的规则文档, so that 流程不靠会话记忆传承。
48. As the owner, I want 每类任务有标准任务单格式(输入/验收/门禁命令/产物路径)且视觉比对成为第一个符合格式的任务原子, so that 未来把「我手动指挥」升级为「编排层自动接单」时不需要改内核。

### 命名治理(Track G)

49. As a developer, I want 一页命名公约(目录/文件/变量/函数/对象/路由/env/DB 各域的规则), so that 「好名字」有判据。
50. As a developer, I want 全仓违例清单按爆炸半径分级(纯内部/跨包导出/对外契约), so that 改名的风险可控、对外契约默认不动。
51. As a developer, I want 内部与跨包违例经语义化重命名清零且每个 PR 测试数不变, so that 改名不夹带行为变化。
52. As a developer, I want lint 层的命名规则开启(Python N 系列;TS 侧按工具实际能力核实后配置), so that 新代码不再产生新违例。
53. As the owner, I want 对外契约(URL/env 键/DB 列)的违例单独成清单交我逐项裁决, so that 兼容性破坏永远是显式决定。

### 历史治理(Track E,终局)

54. As the owner, I want git 历史压缩为按里程碑组织的干净序列(约 30-60 个 commit,message 含原 PR 号与变更摘要), so that 仓库历史讲得清这个项目是怎么长成的。
55. As the owner, I want 所有 AI 署名尾部(Co-Authored-By/Generated-with)从历史与未来 commit 中消失, so that 提交记录以我为作者主体。
56. As the owner, I want 重写前有可恢复性实证的全量备份、重写后 CI/部署/覆盖率在新 SHA 上全绿, so that 这次不可逆操作有回路。
57. As a developer, I want 重写的连带(ruleset 先拆后建、codecov 基线重置、文档内 commit 链接修复、worktree 重建)有 checklist 逐项执行, so that 不炸出隐性断链。(注:旧 SHA 在 GitHub 的 PR refs 中仍可达,本轨是表述性清洗而非密码学清除——已知且接受。)

### 文档与交接

58. As the owner, I want 一份 integration 文档(env/secrets 三级分布、域名拓扑、数据链路、部署链、本地开发)作为单一事实来源, so that 任何新会话/新 agent 不用考古就能上手。
59. As the owner, I want spec 评审与签核流程本身也被记录(双席、复核轮、签核人), so that 「这个范围是谁在什么信息下定的」可追溯。

## Implementation Decisions

**上线形态**
- prod 纯展示由构建期开关控制:**`VITE_SHOWCASE_MODE`,经 GitHub Environment variables 在部署侧构建时注入**(沿用现有 per-env `VITE_*` 注入与非空 preflight 机制;staging 注 false,production 注 true)。SSR 与 client 因同一次构建内联而天然同源。〔席 A B1 裁决:放弃「wrangler vars 构建期常量」的错误设想〕
  **严格布尔契约**〔席 B ①〕:解析只接受字符串 `"true"`/`"false"` 显式等值,其他值(空/缺席/大小写变体)构建期 fail-closed;该键进 env 类型声明、deploy preflight 允许值校验、既有 deploy-vite-env 契约测试必填清单;staging=false 与 production=true 各以真实部署后 E2E 取证(staging chat 可达、prod 弹层)。
- 「开发中」提示为一个复用的 dialog 组件:動森设计语言(奶油底/teal/3D 按压影/Zen Maru Gothic),三语文案走现有 i18n 资源,`role=dialog` + 焦点管理;showcase 模式下接管所有交互点,非 showcase 行为不变。
- Hero 搜索在非 showcase 环境恢复设计稿语义:提交携带 query 跳转 chat(修复现存的吞 query 缺陷);showcase 环境弹提示。
- Graduation 转场不进本轮(归 S1);Splash 静态版为已实现现状,列入视觉帧清单。
- 域名拓扑(apex/www/子域/301)全部由 Pulumi 声明;api/chat 子域按既有 #550 议题裁决入 IaC;旧域名 301 由 edge 层规则实现。
- CANONICAL origin 保持硬编码常量并由单测锁值(历史上构建期变量为空串的事故是实证依据)。

**视觉质量闸(双层阈值)**〔席 A B2 裁决〕
- 正典化:设计稿 mockup 先剥离其开发态 chrome(页内切换控件、装饰动画脚本),字体改为与实现同源的**自托管字体文件**,冻结为「正典快照」,此后 mockup 原稿只增不改。
- 收敛层(mockup ↔ 实现,两个独立 DOM):比例阈值起步(约 0.5-1%),diff 热图产出差异清单,opencode 逐差修复,阈值棘轮只降不升;动画冻结(reducedMotion)、动态区 mask、昼/夜以 class/storage 注入而非点击 UI。
- 回归层(实现 ↔ 自身基线):收敛完成的帧升格为基线,阈值 ≤ 个位数像素,CI 阻塞。
- 帧清单(五帧):landing 昼、landing 夜、移动端(390×844)、Splash、已登录首页;后者用测试态 storageState 会话注入。**降级出口收紧**〔席 B ②〕:任何帧移出阻塞集都是范围变更,须 owner 显式签核并同步 spec/GOAL 两份文档——执行者无权自行降级。
- 全链路(基线生成与 CI 比对)固定在同一 Playwright 官方容器镜像内。
- 封装为参数化任务原子(页面/viewport/模式入参、退出码判定、diff 工件落盘),同时是 Track F 任务单格式的首个实例。

**CI/CD**
- 双车道收敛严格走并集三段:必需检查先加新名、观察、再删旧道与旧名;每次动 ruleset 前存档全量配置。ruleset 无 bypass actor,不允许任何一步造成必需检查空窗。
- 九包 pipeline 复制既有 web pipeline 模式;path 过滤方案沿 CI-1 设计稿(PR 侧无 paths,merge_group 全量);`changes` 聚合 job 与 paths-filter 随最后一包退役。
- 四条 meta 断言进独立 quality pipeline(无 path 过滤的不动点),并把 actionlint 迁入。
- attestation 采用**每环境一构建一证明**(per-env `VITE_*` 内联决定了产物按环境分化;deploy 侧校验对应环境的证明)。〔席 A M3 裁决〕
  **可追溯链语义**〔席 B ③〕:验收不是「该 SHA 存在任意 attestation」,而是从部署版本反查——规范化打包范围 → SHA-256 subject → attestation(校验 predicate/issuer/ref)→ 部署后读 Cloudflare version metadata 验证同一 digest;验证通过后禁止重建再部署。细节(打包规范、metadata 读法)ticket 化时定,语义以本条为准。
- merge queue 启用前完成设计稿列出的七项前置核查,含 merge_group 下 SHA 语义的实测记录。
- SHA pinning 仓库级强制开启;repo 级 CF 凭证删除(env 级已就位)。

**数据供给**
- 顺序硬约束:ingest 收口(WorkerEntrypoint 内部化)→ 抓取层加重试/退避 → 才允许挂定时任务。
- 定时任务落在 catalog Worker 自身(Cron Triggers,三环境段照 maintenance Worker 范式);两类 job:种子预收录(清单为仓库内配置,10-20 部)与 TTL 刷新(取最旧 fetched_at 的 N 件重灌;job 表的领取语义已支持重取)。
- 上游礼貌:单飞与负缓存沿用现状;新增退避上限与批间隔;UA 保持既有标识。

**测试自动化**
- Playwright 官方 Test Agents,loop 绑 opencode;探索产物目录与生成目录先行加入测试忽略清单(防未审产物进门禁),该忽略必须先于任何生成物存在。
- 晋升闸门:人审计划 → Generator 产码 → 两连绿 + 变异检验(改坏被测代码必须红)+ locator 人读 + 无时序断言 → 移入正式套件。
- Healer 仅本地;CI 增加护栏断言(PR diff 不得包含未晋升的生成物)。〔席 A m8 采纳〕
- 巡检走 accessibility-tree/CLI 通道(文本模型可驱动);视觉判断场景才用有视觉的后备。

**Agent 体系**
- skills 清洗清单:Vercel 系全删;Codex skill 按其重新启用的现实改写(rescue=代写/诊断、adversarial-review=评审、模型与 effort 透传);Supabase 系标注随 auth 迁移退役;存留 skill 逐一对源码复核自述。
- 角色重写:executor=opencode 派工纪律(模型优先级、-f 位置、验收义务、变异检验);reviewer=双席制(spec:Fable+Codex GPT Sol xhigh;代码:按模型派工表);tester=Test Agents 管线操作员;planner=grilling→to-spec→to-tickets 流程执行者。
- 工作流单页化为规则文档,判据全部是可执行命令;任务单 schema 定义输入/验收/门禁/产物四段。

**命名治理**
- 公约覆盖:目录与文件(TS 组件 PascalCase、其余 kebab/camel 按域;Python snake)、导出符号、布尔/handler/集合语义规则、缩写禁则、路由/env/DB 命名域。
- 三级分级:L1 纯内部(LSP 重命名)、L2 跨包导出(逐包一 PR、消费者同步)、L3 对外契约(URL/env/DB 列)默认不改、清单交 owner 逐项裁决。
- lint 防回潮:Python 开 ruff N 系列;TS 侧先核实 oxlint 对命名规则的实际支持能力再定配置方案(不预设不存在的规则)。〔席 A m3 采纳〕

**历史治理**
- filter-repo 一次完成署名剥除与里程碑压缩;压缩 message 含原 PR 号清单但不复写署名字样。
- 连带 checklist(可执行 runbook,ticket 化时逐步落单)〔席 A M4 + 席 B ⑥〕:
  ①技术性封窗:暂停 GitHub Actions 与 merge queue(不是口头「禁止推送」)→
  ②`git for-each-ref` 枚举全部 heads/tags/remote refs/stash 并逐一裁决——**保留分支(如 backend-survey)必须同步重写并 force-push**,否则旧历史与署名经它仍公开可达 →
  ③删除/停用 ruleset → force-push 全部保留 refs → 重建 ruleset → 恢复 Actions →
  ④codecov 基线重置、文档内 commit 链接扫描修复、全部 worktree 重建、**本地 hooks 重装并自测** →
  ⑤双面验证:**服务端权威枚举**(`git ls-remote --heads --tags origin`——显式限定命名空间,
  避免 refs/pull 混入比较,
  与显式允许集合比对——本地 for-each-ref 不权威,只负责 local heads/remote-tracking/stash)+
  允许集合内遍历断言 trailer 零残留与 commit 数;CI/部署/覆盖率新 SHA 全绿。
- 未来署名由工具配置关闭(includeCoAuthoredBy=false)。
- 时点:一切其他 Track 关账、0 open PR 之后,单独一个执行窗口。

**Sequencing(排波依据,/to-tickets 按此拆)**
- spec 审核期即可先行:Track 0(止血)、Track A(大扫除无争议项)。
- 签核后并行五轨:B(CI)∥ C(landing→prod)∥ D(测试+数据)∥ F(agent 体系)∥ G(命名)。
- 轨内硬依赖:C 的域名/生产发布依赖「landing 修复 + 视觉收敛 + showcase 开关」全部就绪;
  B 的九包复制依赖双车道收敛先行;D 的 cron 依赖 ingest 收口与退避;G 的批量重命名依赖公约与分级清单。
- Track E(历史)终局单独窗口:其余全部关账、0 open PR 之后。
- Track 0.1 的实现归属:staging 免挑战规则由 **staging stack** 持有(gate ruleset 同款先例)。

**过程规约**
- spec 双席评审 = Fable + Codex GPT Sol(xhigh),复核轮后 owner 签核;调研 sub agent 默认 sonnet/haiku。
- 执行满负荷并行;每 PR 过两路评论闸(线程 + 顶层 findings)与头提交新鲜闸。

## Testing Decisions

**测什么样的测试算好测试**:只测外部行为(HTTP 响应、渲染结果、CI check 结论、文件系统断言),不测实现细节;时钟必 mock;无条件逻辑;变异检验是绿灯的唯一有效性证明(改坏被测物必须变红)。

**接缝(由高到低,优先最高的既有接缝;新接缝只提最高点)**:
1. **已部署域名的 HTTP 面**(最高):smoke/API 断言直接打 staging/prod 域名——上线、301、免挑战、闸门、healthz 全在这一缝验。既有先例:post-deploy smoke 脚本及其行为测试。
2. **GitHub API / check-runs 面**:CI 类 AC(双车道消灭、必需检查集合、merge queue 状态)断言 GitHub 侧可观测状态,不看 workflow 文本。既有先例:PR 合并前两路检查 hook。
   **attestation 例外**:其验收不是存在性检查,而是完整绑定断言——规范化产物 digest == attestation subject(校验 predicate/issuer/ref)且**部署后**版本 metadata == 同一 digest。**fail-closed:部署版本 metadata 不可读即验收失败**;若 Cloudflare 确实不暴露 digest,须先定义能从实际部署版本反查同一 artifact digest 的等价机制并同步修订本条与 GOAL,才可继续。
3. **Playwright 浏览器面**:landing 行为(弹层、i18n、昼夜)与视觉双层比对。既有先例:现有 e2e 套件与 Storybook 单测。
4. **Pulumi 拓扑单测面**:IaC 类 AC(config-settings 规则、域名资源、闸门)断言合成的资源图。既有先例:topology 系列测试(staging/prod 各一套)。
5. **仓库卫生脚本面**:根目录 allowlist、死引用零残留、署名零残留——全部 grep/ls 型断言脚本,注意零匹配退出码语义。既有先例:README 迁移边界测试、AGENTS 引用检查脚本。
6. **Worker 单测面**(最低,仅数据供给):退避逻辑用注入的假上游与假时钟测;cron 分派照 maintenance Worker 的既有测试形态。
7. **文档/定义产物面**(Track F 专用):角色定义与 workflow 文档的机检 = 链接有效性 + 文中判据命令的 smoke 执行(引用检查脚本先例)。

另:skills 清洗跨两个 scope——repo 级(4 个 tracked)走 PR + 引用检查;user 级(~/.claude 的 Vercel 系等)是 manual-ops,不进 CI 断言。视觉收敛环的比对产物必须含机器可读差异清单(区域/选择器级),不只热图,opencode(无视觉)才可修——格式在 ticket 化时定死。

**被测模块**:web 应用(landing/SEO/showcase)、catalog Worker(ingest/退避/cron)、infra 拓扑、CI 流水线结构、e2e 套件自身(晋升闸门)、仓库卫生。

**每条 AC 的 test-type 标注在 ticket 化(/to-tickets)时逐卡落地**,GOAL 只挂组级勾选与证据。

## Out of Scope

- chat/photo-search/Walk 在 **prod** 开放(staging 全功能继续;GOAL A 五条真实走通验证在 staging 完成并附证据)
- Graduation 转场动画、Walk Mode、任何 S1+ 功能
- 引入新的编排工具(只做任务单格式与首个任务原子)
- `src/animichi` 布局迁移、Python 类型收敛、1-10-50 存量拆分(iter6 Track D 卡:#651/#654/#655)
- Supabase→Neon Auth cutover(#561)
- 上游数据的删除同步(delete-not-in-set)、聚类落库、城市回填(挂账,不进本轮)
- 密码学意义上的历史清除(GitHub 侧旧 SHA 经 PR refs 仍可达,接受)

## Further Notes

- 席 A 首轮 15 条 findings(2 BLOCKER / 5 MAJOR / 8 MINOR)已全数裁决并融入上文;复核轮将对照本版验证。
- GOAL 契约与本 spec 同 PR;GOAL 侧同步补齐:GOAL A 五条验证的逐条判据、integration 文档勾项、Hero query 修复勾项。〔席 A M5〕
- 根目录 allowlist 的精确清单(含 dot 条目计数规则、docker/ 与根 wrangler.toml/Dockerfile 的去留)在 Track A ticket 化时定稿并写进 hygiene 测试;根 wrangler.toml 是 root worker 的活配置,保留。〔席 A M1〕
- MiMo-only 密钥收敛(#684):判据 = 部署配置与文档中不再出现已停用 provider 的键,grep 断言;归入 Track A ticket。〔席 A m1〕
- Lighthouse:CLS 阻塞、LCP 预警起步,N 次取中值,阈值固化在配置文件;跑数后再决定 LCP 是否升级为阻塞。〔席 A m4〕
- 分支清理的「保留清单」以关账时点的 merged 状态现算,不预写死。〔席 A m6〕
- integration 文档(env/secrets 三级分布、域名拓扑、数据链路、部署链、本地开发)与 spec 同 PR 交付,是后续所有 ticket 的环境事实来源。
