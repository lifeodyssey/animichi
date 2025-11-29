# 巡礼Bot简化版：Kaggle ADK Capstone Project 实施计划

**项目名称**：Seichijunrei - Anime Pilgrimage Planning Assistant
**Track**: Concierge Agents
**创建日期**：2025-11-29
**版本**：v1.1 ✨
**更新日期**：2025-11-29
**状态**：设计阶段（优化后）

**v1.1 更新**：
- 新增 PointsSelectionAgent（LlmAgent）替代硬编码过滤
- 移除 ParallelAgent（ContextEnrichmentAgent）
- 优化 Stage 2 workflow 为纯Sequential结构
- LlmAgent 数量：5个 → 6个

---

## 目录

1. [项目背景](#1-项目背景)
2. [核心概念覆盖策略](#2-核心概念覆盖策略)
3. [架构设计](#3-架构设计)
4. [详细组件设计](#4-详细组件设计)
5. [Session State管理](#5-session-state管理)
6. [用户交互流程](#6-用户交互流程)
7. [实施步骤](#7-实施步骤)
8. [测试策略](#8-测试策略)
9. [评分优化策略](#9-评分优化策略)
10. [附录](#10-附录)

---

## 1. 项目背景

### 1.1 竞赛信息

- **竞赛名称**：Kaggle ADK Capstone Project
- **Track**：Concierge Agents（个人生活助手类）
- **提交截止**：2025年12月1日 11:59 AM Pacific Time
- **评分标准**：
  - Category 1: The Pitch (30分)
    - Core Concept & Value (15分)
    - Writeup (15分)
  - Category 2: The Implementation (70分)
    - Technical Implementation (50分)
    - Documentation (20分)
  - Bonus (最多20分)
    - Effective Use of Gemini (5分)
    - Agent Deployment (5分)
    - YouTube Video (10分)

### 1.2 项目定位

**问题陈述**：动漫巡礼（圣地巡礼）爱好者在规划行程时面临以下挑战：
- 难以找到完整的巡礼点位信息
- 不知道如何安排合理的游览顺序
- 缺乏交通和时间规划建议

**解决方案**：Seichijunrei Bot 是一个基于ADK的智能对话助手，帮助用户：
1. 根据动漫名称搜索并选择作品
2. 自动获取相关巡礼点位
3. 生成个性化的游览路线建议

**创新价值**：
- 首个结合Bangumi和Anitabi两大动漫数据库的规划工具
- 多轮对话式交互，自然流畅的用户体验
- 充分展示ADK multi-agent系统的强大能力

---

## 2. 核心概念覆盖策略

### 2.1 必须展示的概念（至少3个）

我们将展示**6个核心概念**，超过要求的3个：

| # | 核心概念 | 实现方式 | 代码位置 | 展示优势 |
|---|---------|---------|---------|---------|
| 1 | **Multi-agent system** | • SequentialAgent (2个workflows)<br>• LlmAgent (6个) ✨<br>• BaseAgent (1个) | `_workflows/*.py`<br>`_agents/*.py` | ✅ 展示agent组合能力 |
| 2 | **Custom Tools** | • search_bangumi_subjects<br>• plan_route | `tools/` | ✅ 展示工具集成 |
| 3 | **Sessions & State** | • DatabaseSessionService<br>• 跨invocation持久化 | `agent.py` | ✅ 展示状态管理 |
| 4 | **Long-running ops** | • 两阶段invocation模式<br>• 模拟pause/resume | 整体workflow设计 | ✅ 展示理解 |
| 5 | **Observability** | • Structlog日志<br>• 事件追踪 | `utils/logger.py` | ✅ 已有基础 |
| 6 | **Deployment (Bonus)** | • Cloud Run部署 | `deploy/` | ⭐ +5分 |

### 2.2 Bonus机会

- ✅ **Use Gemini** (gemini-2.0-flash in all LlmAgents) → +5分
- ✅ **Agent Deployment** (Cloud Run) → +5分
- ⚠️ **YouTube Video** (3分钟演示) → +10分（可选）

**目标总分**：90-100分

---

## 3. 架构设计

### 3.1 整体架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Root Agent (LlmAgent)                            │
│  Name: "PilgrimageBot"                                              │
│  Model: gemini-2.0-flash                                            │
│  Role: 条件路由 + 对话管理                                           │
│                                                                     │
│  Logic:                                                             │
│    if (!state.bangumi_candidates)      → Call Stage 1             │
│    else if (!state.selected_bangumi)    → Wait for user input     │
│    else                                  → Call Stage 2             │
└────────────────────────┬────────────────────────────────────────────┘
                         │
         ┌───────────────┴───────────────┐
         │                               │
         ▼                               ▼
┌─────────────────────┐         ┌─────────────────────┐
│   Stage 1 Workflow  │         │   Stage 2 Workflow  │
│  Bangumi Search     │         │  Route Planning     │
│  (SequentialAgent)  │         │  (SequentialAgent)  │
└─────────────────────┘         └─────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                        Stage 1: Bangumi Search                      │
│                        (SequentialAgent)                            │
├─────────────────────────────────────────────────────────────────────┤
│  Sub-agent 1: ExtractionAgent (LlmAgent)                           │
│    • Model: gemini-2.0-flash                                        │
│    • Input: user_query                                              │
│    • Output: extraction_result {bangumi_name, location}            │
│    • Output Key: "extraction_result"                                │
├─────────────────────────────────────────────────────────────────────┤
│  Sub-agent 2: BangumiCandidatesAgent (SequentialAgent)             │
│    ┌──────────────────────────────────────────────────────────────┐│
│    │  Step 1: BangumiSearcher (LlmAgent)                          ││
│    │    • Tools: [search_bangumi_subjects_tool]                   ││
│    │    • Output Key: "temp:raw_results"                          ││
│    ├──────────────────────────────────────────────────────────────┤│
│    │  Step 2: CandidatesFormatter (LlmAgent)                      ││
│    │    • Output Schema: BangumiCandidatesResult                   ││
│    │    • Output Key: "bangumi_candidates"  (持久化)               ││
│    └──────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                        Stage 2: Route Planning                      │
│                        (SequentialAgent)                            │
├─────────────────────────────────────────────────────────────────────┤
│  Sub-agent 1: UserSelectionAgent (LlmAgent)                        │
│    • Model: gemini-2.0-flash                                        │
│    • Input: user_query + bangumi_candidates                        │
│    • Output: selected_bangumi {bangumi_id, title, ...}             │
│    • Output Key: "selected_bangumi"                                 │
├─────────────────────────────────────────────────────────────────────┤
│  Sub-agent 2: PointsSearchAgent (BaseAgent)                        │
│    • Calls: AnitabiClient.get_bangumi_points()                     │
│    • Fetches ALL points (no filtering)                             │
│    • Output: all_points[] (可能10-50个点位)                         │
│    • Output Key: "all_points"                                       │
├─────────────────────────────────────────────────────────────────────┤
│  Sub-agent 3: PointsSelectionAgent (LlmAgent) ✨ NEW               │
│    • Model: gemini-2.0-flash                                        │
│    • Input: all_points[] + extraction_result.location              │
│    • Task: 智能选择8-12个最合适的点位                               │
│    • Considers: 地理距离、剧情重要性、游览可行性                      │
│    • Output Schema: PointsSelectionResult                           │
│    • Output Key: "selected_points"                                  │
├─────────────────────────────────────────────────────────────────────┤
│  Sub-agent 4: RoutePlanningAgent (LlmAgent)                        │
│    • Model: gemini-2.0-flash                                        │
│    • Input: selected_points[] + location                           │
│    • Tools: [plan_route_tool]                                      │
│    • Output Schema: RoutePlan                                       │
│    • Output Key: "route_plan"                                       │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 数据流图

```
用户输入："我在宇治 想去巡礼京吹"
         ↓
┌────────────────────────────────────┐
│  Invocation 1 - Stage 1            │
├────────────────────────────────────┤
│  ExtractionAgent                   │
│    → bangumi_name: "京吹"          │
│    → location: "宇治"              │
├────────────────────────────────────┤
│  BangumiCandidatesAgent            │
│    → Search Bangumi API            │
│    → Format to 3-5 candidates      │
│    → Save to state                 │
└────────────────────────────────────┘
         ↓
State (persisted to DB):
{
  "user_query": "我在宇治 想去巡礼京吹",
  "extraction_result": {...},
  "bangumi_candidates": [
    {bangumi_id: 124312, title: "響け！ユーフォニアム", ...},
    {bangumi_id: 140041, title: "響け！ユーフォニアム2", ...}
  ]
}
         ↓
Bot响应："找到以下动漫作品，请选择..."
         ↓
--- Session ends, waiting for user ---
         ↓
用户输入："选择1"
         ↓
┌────────────────────────────────────┐
│  Invocation 2 - Stage 2            │
├────────────────────────────────────┤
│  Load previous state from DB       │
│  UserSelectionAgent                │
│    → Parse "选择1"                  │
│    → Match to bangumi_id: 124312   │
├────────────────────────────────────┤
│  PointsSearchAgent                 │
│    → Anitabi API call              │
│    → Fetch ALL 35 points           │
│    → Save as all_points[]          │
├────────────────────────────────────┤
│  PointsSelectionAgent ✨           │
│    → Read all_points[] (35 items)  │
│    → LLM intelligently selects     │
│    → Based on: location="宇治"     │
│    → Selects 10 best points        │
│    → Save as selected_points[]     │
├────────────────────────────────────┤
│  RoutePlanningAgent                │
│    → Read selected_points[] (10)   │
│    → plan_route_tool               │
│    → Generate route                │
└────────────────────────────────────┘
         ↓
State (updated):
{
  ...(previous state),
  "selected_bangumi": {...},
  "all_points": [...35个点位...],           # ✨ 所有Anitabi点位
  "selected_points": [...10个精选点位...],   # ✨ LLM智能选择的点位
  "route_plan": {
    recommended_order: [...],
    route_description: "...",
    transport_tips: "...",
    selection_rationale: "优先选择宇治市内的标志性场景..."  # ✨ 选择理由
  }
}
         ↓
Bot响应："为您规划了以下巡礼路线：..."
```

### 3.3 核心概念映射

| 组件 | 核心概念 | 具体体现 |
|------|---------|---------|
| Root Agent | Multi-agent system (LlmAgent) | 条件路由逻辑 |
| Stage 1 Workflow | Multi-agent (Sequential) | ExtractionAgent → BangumiCandidatesAgent |
| BangumiCandidatesAgent | Multi-agent (Sequential嵌套) | SearchAgent → FormatterAgent |
| Stage 2 Workflow | Multi-agent (Sequential) | Selection → PointsSearch → PointsSelection → RoutePlanning |
| PointsSearchAgent | Multi-agent (BaseAgent) | 确定性I/O操作（获取所有点位） |
| PointsSelectionAgent | Multi-agent (LlmAgent) | ✨ 智能决策（选择最佳点位） |
| RoutePlanningAgent | Multi-agent (LlmAgent) | 基于选择结果生成路线 |
| search_bangumi_subjects | Custom Tools | FunctionTool with BangumiClient |
| plan_route | Custom Tools | FunctionTool with SimplePlanner |
| DatabaseSessionService | Sessions & State | 跨invocation持久化 |
| Two-stage invocation | Long-running ops | 模拟pause/resume |
| Structlog | Observability | 结构化日志和事件追踪 |

---

## 4. 详细组件设计

### 4.1 Root Agent

**文件**：`adk_agents/seichijunrei_bot/agent.py`

```python
from google.adk.agents import LlmAgent
from google.adk.sessions import DatabaseSessionService
from ._workflows.bangumi_search_workflow import bangumi_search_workflow
from ._workflows.route_planning_workflow import route_planning_workflow

# ✅ 核心概念 3: Sessions & State Management
session_service = DatabaseSessionService(
    database_url="sqlite:///./data/sessions.db",
    echo=True  # Enable SQL logging for observability
)

# ✅ 核心概念 1: Multi-agent system - LlmAgent
root_agent = LlmAgent(
    name="PilgrimageBot",
    model="gemini-2.0-flash",  # ✅ Bonus: Use Gemini
    instruction="""
    你是动漫巡礼规划助手 Seichijunrei Bot。

    工作流程：
    1. 检查 session state 决定当前阶段
    2. 根据阶段调用相应的workflow或给出响应

    阶段判断逻辑：
    - 如果 state 中没有 'bangumi_candidates':
        调用 bangumi_search_workflow
        展示候选列表给用户
        
    - 如果 state 中有 'bangumi_candidates' 但没有 'selected_bangumi':
        这是中间状态，用户正在选择
        从 state.bangumi_candidates 读取之前的列表
        友好地展示列表并提示用户选择（输入数字或描述）
        不要调用任何workflow
        
    - 如果 state 中有 'selected_bangumi':
        调用 route_planning_workflow
        生成完整的路线建议

    重要原则：
    - 使用session state共享数据
    - 保持对话自然流畅
    - 提供清晰的选择指引
    """,
    sub_agents=[
        bangumi_search_workflow,
        route_planning_workflow
    ]
)
```

**关键设计点**：
1. **条件路由逻辑**：通过检查state决定执行哪个workflow
2. **Session持久化**：使用DatabaseSessionService确保跨invocation保存state
3. **自然对话**：中间状态不调用workflow，只展示之前的结果

---

### 4.2 Stage 1: Bangumi Search Workflow

**文件**：`adk_agents/seichijunrei_bot/_workflows/bangumi_search_workflow.py`

```python
from google.adk.agents import SequentialAgent
from .._agents.extraction_agent import extraction_agent
from .._agents.bangumi_candidates_agent import bangumi_candidates_agent

# ✅ 核心概念 1: Multi-agent system - SequentialAgent
bangumi_search_workflow = SequentialAgent(
    name="BangumiSearchWorkflow",
    sub_agents=[
        extraction_agent,           # Step 1
        bangumi_candidates_agent    # Step 2 (itself Sequential)
    ]
)
```

#### 4.2.1 ExtractionAgent

**文件**：`adk_agents/seichijunrei_bot/_agents/extraction_agent.py`

```python
from google.adk.agents import LlmAgent
from .._schemas import ExtractionResult

extraction_agent = LlmAgent(
    name="ExtractionAgent",
    model="gemini-2.0-flash",
    instruction="""
    从用户输入中提取关键信息：
    1. 动漫名称 (bangumi_name)
    2. 用户位置 (location)
    
    用户可能的输入示例：
    - "我在宇治 想去巡礼京吹"
    - "东京出发，想看你的名字的场景"
    - "秋叶原附近 命运石之门"
    
    提取策略：
    - bangumi_name: 动漫的常用名、简称或全名
    - location: 地点、车站名、区域名
    
    如果信息不明确，尽力推断合理值。
    """,
    output_schema=ExtractionResult,
    output_key="extraction_result"
)
```

**Schema定义**：`_schemas.py`
```python
from pydantic import BaseModel

class ExtractionResult(BaseModel):
    """用户输入提取结果"""
    bangumi_name: str  # 动漫名称
    location: str      # 用户位置
```

#### 4.2.2 BangumiCandidatesAgent

**文件**：`adk_agents/seichijunrei_bot/_agents/bangumi_candidates_agent.py`

```python
from google.adk.agents import SequentialAgent, LlmAgent
from ..tools.bangumi_search import search_bangumi_subjects_tool
from .._schemas import BangumiCandidatesResult

# Step 1: Search using tool
_bangumi_searcher = LlmAgent(
    name="BangumiSearcher",
    model="gemini-2.0-flash",
    tools=[search_bangumi_subjects_tool],  # ✅ 核心概念 2: Custom Tool
    instruction="""
    使用 search_bangumi_subjects 工具搜索动漫作品。
    
    输入：{extraction_result.bangumi_name}
    
    调用工具获取搜索结果。
    """,
    output_key="temp:raw_bangumi_results"  # 临时存储
)

# Step 2: Format to candidates list
_candidates_formatter = LlmAgent(
    name="CandidatesFormatter",
    model="gemini-2.0-flash",
    instruction="""
    从原始搜索结果中选择最相关的 3-5 个作品作为候选。
    
    输入：{temp:raw_bangumi_results}
    
    选择标准：
    1. 标题相关性（中文/日文匹配）
    2. 作品类型（优先TV动画、剧场版）
    3. 知名度和评分
    
    为每个候选生成简短的摘要（1-2句话），帮助用户识别。
    
    输出格式：
    - candidates: 候选列表（3-5个）
    - query: 原始查询词
    - total: 找到的总数
    """,
    output_schema=BangumiCandidatesResult,
    output_key="bangumi_candidates"  # ✅ 持久化到session state
)

# ✅ 核心概念 1: Multi-agent system - Nested SequentialAgent
bangumi_candidates_agent = SequentialAgent(
    name="BangumiCandidatesAgent",
    sub_agents=[_bangumi_searcher, _candidates_formatter]
)
```

**Schema定义**：
```python
class BangumiCandidate(BaseModel):
    """单个Bangumi候选作品"""
    bangumi_id: int
    title: str           # 日文标题
    title_cn: str | None # 中文标题
    air_date: str | None # 播出日期 "YYYY-MM"
    summary: str         # 简短介绍（1-2句话）

class BangumiCandidatesResult(BaseModel):
    """Bangumi搜索候选结果"""
    candidates: list[BangumiCandidate]
    query: str
    total: int  # 搜索到的总数
```

---

### 4.3 Stage 2: Route Planning Workflow

**文件**：`adk_agents/seichijunrei_bot/_workflows/route_planning_workflow.py`

```python
from google.adk.agents import SequentialAgent
from .._agents.user_selection_agent import user_selection_agent
from .._agents.points_search_agent import points_search_agent
from .._agents.points_selection_agent import points_selection_agent  # ✨ NEW
from .._agents.route_planning_agent import route_planning_agent

# ✅ 核心概念 1: Multi-agent system - SequentialAgent
route_planning_workflow = SequentialAgent(
    name="RoutePlanningWorkflow",
    sub_agents=[
        user_selection_agent,      # Step 1: Parse user selection
        points_search_agent,       # Step 2: Fetch ALL points from Anitabi
        points_selection_agent,    # Step 3: ✨ Intelligently select 8-12 best points
        route_planning_agent       # Step 4: Generate route plan
    ]
)
```

#### 4.3.1 UserSelectionAgent

**文件**：`adk_agents/seichijunrei_bot/_agents/user_selection_agent.py`

```python
from google.adk.agents import LlmAgent
from .._schemas import UserSelectionResult

user_selection_agent = LlmAgent(
    name="UserSelectionAgent",
    model="gemini-2.0-flash",
    instruction="""
    从用户输入中识别选择的动漫作品。
    
    输入：
    - user_query: 用户的选择输入
    - bangumi_candidates: 之前展示的候选列表
    
    用户可能的输入方式：
    - 数字："1", "2", "3"
    - 序号词："第一个", "first", "the second one"
    - 描述性："第一季的", "2015年的", "TV版"
    - 标题："吹响吧上低音号"
    
    任务：
    1. 解析用户输入
    2. 从 bangumi_candidates 中找到匹配项
    3. 提取该项的完整信息
    
    如果无法明确匹配，选择最可能的一个。
    """,
    output_schema=UserSelectionResult,
    output_key="selected_bangumi"
)
```

**Schema定义**：
```python
class UserSelectionResult(BaseModel):
    """用户选择结果"""
    bangumi_id: int
    bangumi_title: str       # 日文标题
    bangumi_title_cn: str | None
    selection_confidence: float  # 0-1，选择置信度
```

#### 4.3.2 PointsSearchAgent

**文件**：`adk_agents/seichijunrei_bot/_agents/points_search_agent.py`

```python
from google.adk.agents import BaseAgent
from google.adk.core import InvocationContext, Event, EventActions
from clients.anitabi import AnitabiClient
from utils.logger import logger

# ✅ 核心概念 1: Multi-agent system - BaseAgent
class PointsSearchAgent(BaseAgent):
    """
    从Anitabi API获取所有巡礼点位（不过滤）

    ✨ 改动：返回ALL点位，由后续的PointsSelectionAgent进行智能选择

    ✅ 核心概念 2: Custom tool integration (AnitabiClient)
    ✅ 核心概念 5: Observability (structlog)
    """

    def __init__(self):
        super().__init__(name="PointsSearchAgent")

    async def _run_async_impl(self, ctx: InvocationContext):
        # Read from state
        selected = ctx.session.state.get("selected_bangumi", {})
        bangumi_id = selected.get("bangumi_id")

        if not bangumi_id:
            logger.error("missing_bangumi_id", agent=self.name)
            raise ValueError("selected_bangumi.bangumi_id not found in state")

        # ✅ Observability: Log start
        logger.info(
            "fetching_all_points",
            agent=self.name,
            bangumi_id=bangumi_id
        )

        # Call Anitabi API - fetch ALL points
        client = AnitabiClient()
        try:
            points = await client.get_bangumi_points(str(bangumi_id))
        except Exception as e:
            logger.error("anitabi_api_error", error=str(e))
            raise

        # Format result - save as all_points (no filtering!)
        result = {
            "all_points": [p.dict() for p in points],  # ✨ Changed: all_points
            "points_meta": {
                "total": len(points),
                "source": "anitabi",
                "bangumi_id": bangumi_id
            }
        }

        # Update state
        ctx.session.state.update(result)

        # ✅ Observability: Log completion
        logger.info(
            "all_points_fetched",
            agent=self.name,
            total_count=len(points)  # 可能是10-50个
        )

        # Yield event
        yield Event(
            author=self.name,
            content=result,
            actions=EventActions(escalate=False)
        )

points_search_agent = PointsSearchAgent()
```

#### 4.3.3 PointsSelectionAgent ✨ NEW

**文件**：`adk_agents/seichijunrei_bot/_agents/points_selection_agent.py`

**关键设计**：这是整个简化方案的核心 - 用LLM的智能决策替代硬编码的过滤逻辑。

```python
from google.adk.agents import LlmAgent
from .._schemas import PointsSelectionResult

# ✅ 核心概念 1: Multi-agent system - LlmAgent for intelligent decision making
points_selection_agent = LlmAgent(
    name="PointsSelectionAgent",
    model="gemini-2.0-flash",
    instruction="""
    从所有巡礼点中智能选择最适合的8-12个点位。

    输入：
    - all_points: 所有可用的巡礼点列表（可能有10-50个）
    - extraction_result.location: 用户起点位置
    - selected_bangumi.bangumi_title: 动漫名称

    选择标准（按优先级排序）：

    1. **地理合理性** (最高优先级)
       - 优先选择距离用户起点较近的点位
       - 避免选择过于分散的点位（一天内难以游览完）
       - 考虑点位之间的距离，形成合理的游览路线

    2. **剧情重要性**
       - 优先选择剧情中的标志性场景（OP/ED场景、重要转折点）
       - 保留经典场景的取景地
       - 平衡不同集数，尽量覆盖主要剧情线

    3. **游览可行性**
       - 优先选择公共场所（公园、神社、街道、车站等）
       - 避免私人住宅或需要特殊许可的场所
       - 考虑是否有营业时间限制

    4. **数量平衡**
       - 选择8-12个点位
       - 既要丰富体验，又要避免行程过于紧张

    输出要求：
    - selected_points: 选中的点位列表（从all_points中选择）
    - selection_rationale: 简要说明选择理由（2-3句话）
    - estimated_coverage: 覆盖的集数范围（如"第1-6集"）
    - total_available: 可用点位总数

    重要提示：
    - 必须从all_points中选择，不要创造新的点位
    - 输出的selected_points应保留原始点位的所有字段
    - 选择理由要具体，解释为什么这些点位最适合
    """,
    output_schema=PointsSelectionResult,
    output_key="points_selection_result"
)
```

**Schema定义**：
```python
class PointsSelectionResult(BaseModel):
    """点位智能选择结果"""
    selected_points: list[dict]      # 选中的点位（8-12个）
    selection_rationale: str         # 选择理由（2-3句话）
    estimated_coverage: str          # 覆盖集数范围，如"第1-6集"
    total_available: int             # 可用点位总数
    rejected_count: int              # 未选择的点位数
```

**为什么这样设计？**

1. **符合agentic AI理念**：让LLM做决策，而不是硬编码"取前10个"
2. **更智能的选择**：
   - LLM能理解"宇治"是个地名，自动优先选择宇治市内的点位
   - 能识别"宇治桥"比"京都市区某商店"更重要
   - 能平衡剧情覆盖和地理合理性
3. **可解释性**：selection_rationale向用户解释为什么选择这些点位
4. **灵活性**：同样的动漫，不同起点会选择不同点位

#### 4.3.4 RoutePlanningAgent

**文件**：`adk_agents/seichijunrei_bot/_agents/route_planning_agent.py`

```python
from google.adk.agents import LlmAgent
from ..tools.route_planning import plan_route_tool
from .._schemas import RoutePlan

route_planning_agent = LlmAgent(
    name="RoutePlanningAgent",
    model="gemini-2.0-flash",
    tools=[plan_route_tool],  # ✅ 核心概念 2: Custom Tool
    instruction="""
    基于精选的巡礼点位生成个性化路线建议。

    输入：
    - extraction_result.location: 用户起点
    - selected_bangumi.bangumi_title: 动漫名称
    - points_selection_result.selected_points: 精选的巡礼点位（8-12个）✨
    - points_selection_result.selection_rationale: 选择理由

    任务：
    使用 plan_route 工具生成详细的路线规划。

    输出应包含：
    1. 推荐的游览顺序
    2. 完整的路线描述（包含选择理由）
    3. 预估时间和距离
    4. 交通建议
    5. 特别提示（营业时间、门票等）

    注意：
    - 点位已经过智能筛选，无需再次过滤
    - 可以在路线描述中引用selection_rationale说明为何选择这些点位
    """,
    output_schema=RoutePlan,
    output_key="route_plan"
)
```

**Schema定义**：
```python
class RoutePlan(BaseModel):
    """路线规划结果"""
    recommended_order: list[str]  # 点位名称列表（按推荐顺序）
    route_description: str        # 完整的文字路线描述
    estimated_duration: str       # "约4-5小时"
    estimated_distance: str       # "约6公里"
    transport_tips: str           # 交通建议
    special_notes: list[str]      # 特别提示
```

---

### 4.4 Custom Tools

#### 4.4.1 search_bangumi_subjects_tool

**文件**：`adk_agents/seichijunrei_bot/tools/bangumi_search.py`

```python
from google.adk.tools import FunctionTool
from clients.bangumi import BangumiClient
from utils.logger import logger

def search_bangumi_subjects(keyword: str, max_results: int = 5) -> dict:
    """
    搜索Bangumi动漫作品
    
    Args:
        keyword: 搜索关键词（动漫名称）
        max_results: 返回结果数量上限
    
    Returns:
        {
            "candidates": [
                {
                    "id": int,
                    "name": str,
                    "name_cn": str,
                    "type": int,
                    "summary": str,
                    "air_date": str,
                    "rating": {"score": float}
                },
                ...
            ],
            "total": int
        }
    
    ✅ 核心概念 2: Custom Tool
    """
    logger.info("bangumi_search_tool_called", keyword=keyword, max_results=max_results)
    
    client = BangumiClient()
    
    try:
        results = client.search_subject(keyword, max_results=max_results)
        
        candidates = [
            {
                "id": r.id,
                "name": r.name,
                "name_cn": r.name_cn,
                "type": r.type,
                "summary": r.summary[:200] if r.summary else "",  # Truncate
                "air_date": r.air_date,
                "rating": {"score": r.rating.score if r.rating else 0}
            }
            for r in results
        ]
        
        logger.info("bangumi_search_completed", found=len(candidates))
        
        return {
            "candidates": candidates,
            "total": len(results)
        }
    
    except Exception as e:
        logger.error("bangumi_search_failed", error=str(e))
        return {
            "candidates": [],
            "total": 0,
            "error": str(e)
        }

# ✅ 核心概念 2: FunctionTool
search_bangumi_subjects_tool = FunctionTool(
    func=search_bangumi_subjects,
    name="search_bangumi_subjects",
    description="Search for anime titles in the Bangumi database. Returns top matching results with metadata."
)
```

#### 4.4.2 plan_route_tool

**文件**：`adk_agents/seichijunrei_bot/tools/route_planning.py`

```python
from google.adk.tools import FunctionTool
from services.simple_route_planner import SimpleRoutePlanner
from utils.logger import logger

def plan_route(
    location: str,
    bangumi_title: str,
    points: list[dict]
) -> dict:
    """
    生成巡礼路线规划（简化版：基于距离排序 + 文本生成）
    
    Args:
        location: 用户起点位置
        bangumi_title: 动漫标题
        points: 巡礼点列表 [{"name": str, "coordinates": {...}, ...}]
    
    Returns:
        {
            "recommended_order": [str],  # 点位名称列表
            "route_description": str,
            "estimated_duration": str,
            "estimated_distance": str,
            "transport_tips": str,
            "special_notes": [str]
        }
    
    ✅ 核心概念 2: Custom Tool
    """
    logger.info("route_planning_tool_called", 
                location=location, 
                bangumi=bangumi_title, 
                points_count=len(points))
    
    # 使用简单的路线规划器
    planner = SimpleRoutePlanner()
    
    try:
        plan = planner.generate_plan(
            origin=location,
            anime=bangumi_title,
            points=points
        )
        
        logger.info("route_plan_generated", duration=plan["estimated_duration"])
        
        return plan
    
    except Exception as e:
        logger.error("route_planning_failed", error=str(e))
        # Fallback: 返回基础建议
        return {
            "recommended_order": [p.get("name", "") for p in points[:10]],
            "route_description": f"从{location}出发，按距离顺序游览{bangumi_title}的巡礼点。",
            "estimated_duration": "约半天",
            "estimated_distance": "视具体点位而定",
            "transport_tips": "建议使用公共交通工具",
            "special_notes": ["请提前确认营业时间"]
        }

# ✅ 核心概念 2: FunctionTool
plan_route_tool = FunctionTool(
    func=plan_route,
    name="plan_route",
    description="Generate pilgrimage route recommendations based on user location and pilgrimage points"
)
```

**SimpleRoutePlanner实现**：`services/simple_route_planner.py`
```python
from typing import Any
import math

class SimpleRoutePlanner:
    """
    简单的路线规划器
    策略：基于地理距离排序 + 模板化文本生成
    """
    
    def generate_plan(
        self,
        origin: str,
        anime: str,
        points: list[dict[str, Any]]
    ) -> dict:
        """
        生成路线规划
        
        Args:
            origin: 起点名称
            anime: 动漫名称
            points: 点位列表（包含coordinates字段）
        
        Returns:
            RoutePlan dict
        """
        # 1. 简化：按剧集顺序排序
        sorted_points = sorted(
            points,
            key=lambda p: (p.get("episode", 99), p.get("time_seconds", 0))
        )
        
        # 2. 取前10个点位（避免过长）
        selected = sorted_points[:10]
        
        # 3. 生成推荐顺序
        recommended_order = [p.get("name", p.get("cn_name", "未知")) for p in selected]
        
        # 4. 生成描述
        description_parts = [
            f"从{origin}出发，游览《{anime}》的巡礼点。",
            "",
            "推荐路线："
        ]
        
        for i, point in enumerate(selected, 1):
            name = point.get("cn_name") or point.get("name", "未知点位")
            episode = point.get("episode", "?")
            description_parts.append(
                f"{i}. {name}（第{episode}集）"
            )
        
        route_description = "\n".join(description_parts)
        
        # 5. 估算时间和距离（简化版）
        point_count = len(selected)
        est_duration_hours = point_count * 0.5  # 每个点约30分钟
        est_distance_km = point_count * 1.5      # 点间平均1.5km
        
        # 6. 生成交通建议
        transport_tips = self._generate_transport_tips(origin, selected)
        
        # 7. 特别提示
        special_notes = [
            "建议提前查询各点位的营业时间",
            "携带地图应用以便实时导航",
            "注意拍照时不要影响他人"
        ]
        
        return {
            "recommended_order": recommended_order,
            "route_description": route_description,
            "estimated_duration": f"约{est_duration_hours:.1f}小时",
            "estimated_distance": f"约{est_distance_km:.1f}公里",
            "transport_tips": transport_tips,
            "special_notes": special_notes
        }
    
    def _generate_transport_tips(self, origin: str, points: list[dict]) -> str:
        """生成交通建议"""
        tips = [
            f"从{origin}出发，建议：",
            "- 使用当地公共交通（电车/巴士）前往各点位",
            "- 点位间距离较近时可步行游览",
            "- 推荐购买一日交通券以节省费用"
        ]
        return "\n".join(tips)
```

---

## 5. Session State管理

### 5.1 State Schema定义

```python
# State keys throughout the workflow

# Always present (initialized by root agent)
{
    "user_query": str,           # 当前用户输入
    "session_id": str,           # Session ID
    "invocation_count": int,     # Invocation计数（用于调试）
}

# After Stage 1 - ExtractionAgent
{
    ...,
    "extraction_result": {
        "bangumi_name": str,
        "location": str
    }
}

# After Stage 1 - BangumiCandidatesAgent
{
    ...,
    "temp:raw_bangumi_results": {...},  # 临时，不持久化
    "bangumi_candidates": {              # ✅ 持久化
        "candidates": [
            {
                "bangumi_id": int,
                "title": str,
                "title_cn": str | None,
                "air_date": str | None,
                "summary": str
            },
            ...
        ],
        "query": str,
        "total": int
    }
}

# After Stage 2 - UserSelectionAgent
{
    ...,
    "selected_bangumi": {        # ✅ 持久化
        "bangumi_id": int,
        "bangumi_title": str,
        "bangumi_title_cn": str | None,
        "selection_confidence": float
    }
}

# After Stage 2 - ParallelDataFetch
{
    ...,
    "points": [                  # ✅ 持久化
        {
            "id": str,
            "name": str,
            "cn_name": str,
            "coordinates": {"lat": float, "lng": float},
            "episode": int,
            "time_seconds": int,
            "screenshot_url": str,
            ...
        },
        ...
    ],
    "points_meta": {
        "total": int,
        "source": "anitabi",
        "bangumi_id": int
    },
    "enriched_context": {        # ✅ 持久化（可选）
        "user_location": str,
        "region_info": str,
        "tips": [str]
    }
}

# After Stage 2 - RoutePlanningAgent
{
    ...,
    "route_plan": {              # ✅ 持久化
        "recommended_order": [str],
        "route_description": str,
        "estimated_duration": str,
        "estimated_distance": str,
        "transport_tips": str,
        "special_notes": [str]
    }
}
```

### 5.2 持久化策略

**DatabaseSessionService配置**：
```python
# adk_agents/seichijunrei_bot/agent.py

from google.adk.sessions import DatabaseSessionService
import os

# ✅ 核心概念 3: Sessions & State Management
session_service = DatabaseSessionService(
    database_url=os.getenv(
        "DATABASE_URL",
        "sqlite:///./data/sessions.db"  # Default to SQLite
    ),
    echo=True,  # Enable SQL logging for observability
    pool_size=5,
    max_overflow=10
)
```

**State前缀语义**：
- **无前缀**：当前session持久化，跨invocation可访问
- **`temp:`**：当前invocation临时，不持久化（如`temp:raw_bangumi_results`）
- **`user:`**：跨session用户级（未使用）
- **`app:`**：全局应用级（未使用）

### 5.3 跨Invocation访问模式

**Invocation 1（搜索候选）**：
```python
# Root agent receives user input
user_query = "我在宇治 想去巡礼京吹"

# Stage 1 executes
# → ExtractionAgent writes: extraction_result
# → BangumiCandidatesAgent writes: bangumi_candidates

# State at end of Invocation 1:
state = {
    "user_query": "我在宇治 想去巡礼京吹",
    "extraction_result": {...},
    "bangumi_candidates": {
        "candidates": [...]  # 3-5 items
    }
}

# Root agent checks: no selected_bangumi
# → Returns candidate list to user
# → Session ends, state persisted to database
```

**Invocation 2（选择并规划）**：
```python
# User sends new input
user_query = "选择1"

# Session service loads previous state from database
# state already contains:
# - extraction_result
# - bangumi_candidates

# Root agent checks: has bangumi_candidates, no selected_bangumi
# → Calls Stage 2

# Stage 2 executes
# → UserSelectionAgent reads bangumi_candidates from state
# → Writes: selected_bangumi
# → ParallelDataFetch writes: points, enriched_context
# → RoutePlanningAgent writes: route_plan

# State at end of Invocation 2:
state = {
    "user_query": "选择1",
    "extraction_result": {...},       # Still there!
    "bangumi_candidates": {...},      # Still there!
    "selected_bangumi": {...},        # New
    "points": [...],                  # New
    "route_plan": {...}               # New
}

# Root agent returns complete route plan
```

---

## 6. 用户交互流程

### 6.1 完整对话示例

```
=== Invocation 1 ===

用户：我在宇治 想去巡礼京吹

Bot：正在为您搜索相关动漫作品...

[ExtractionAgent: 提取 bangumi_name="京吹", location="宇治"]
[BangumiSearcher: 调用Bangumi API]
[CandidatesFormatter: 格式化候选列表]

Bot：找到以下动漫作品，请选择一个：

1. **吹响吧！上低音号** (響け！ユーフォニアム, 2015年4月)
   京都府立北宇治高中吹奏乐部的青春故事

2. **吹响吧！上低音号 第二季** (響け！ユーフォニアム2, 2016年10月)
   北宇治吹奏乐部向全国大赛进发的故事

3. **吹响吧！上低音号3** (響け！ユーフォニアム3, 2024年4月)
   第三季，继续讲述吹奏乐部的成长

请回复数字（如 "1"）或描述（如 "第一季"）来选择。

[Session结束，State持久化到数据库]

=== Invocation 2 ===

用户：选择1

[Session加载之前的State，包含bangumi_candidates]

Bot：好的，您选择了《吹响吧！上低音号》。正在为您规划巡礼路线...

[UserSelectionAgent: 解析"选择1" → bangumi_id=124312]
[ParallelDataFetch开始]
  [PointsSearchAgent: 调用Anitabi API，获得15个巡礼点]
  [ContextEnrichmentAgent: 丰富上下文]
[RoutePlanningAgent: 调用plan_route_tool，生成路线]

Bot：为您规划了以下巡礼路线：

**《吹响吧！上低音号》巡礼路线**

**推荐游览顺序：**
1. 北宇治高中取景地 - 莵道高校（第1集）
2. 宇治桥（第1集）
3. 宇治神社（第2集）
4. 平等院（第3集）
5. 宇治川河畔（第5集）

**详细路线：**
从JR宇治站出发，首先步行10分钟到达北宇治高中的取景地莵道高校。
这里是主角们上学的地方，可以在校门口拍照留念（请注意不要打扰学生）。

接着前往宇治桥，这是剧中多次出现的标志性场景...

**预计时间**：约4-5小时（含参观时间）
**预计距离**：约6公里（主要步行）

**交通建议**：
从JR宇治站出发，建议：
- 使用当地公共交通（电车/巴士）前往各点位
- 点位间距离较近时可步行游览
- 推荐购买一日交通券以节省费用

**特别提示**：
- 建议提前查询各点位的营业时间
- 携带地图应用以便实时导航
- 注意拍照时不要影响他人

祝您巡礼愉快！

[Session结束]
```

### 6.2 边界情况处理

**情况1：用户输入模糊**
```
用户：我想去巡礼动漫

Bot：请提供更具体的信息：
- 您想巡礼哪部动漫？（如："你的名字"、"京吹"）
- 您的出发地点是？（如："东京"、"宇治"）

示例："我在秋叶原 想去巡礼命运石之门"
```

**情况2：搜索无结果**
```
用户：我想去巡礼不存在的动漫ABC

Bot：抱歉，没有找到与"不存在的动漫ABC"相关的作品。

建议：
- 检查拼写是否正确
- 尝试使用作品的完整名称或常用简称
- 确认该作品在Bangumi数据库中有收录

您可以重新输入动漫名称。
```

**情况3：用户选择无效**
```
用户：选择99

Bot：抱歉，您的选择 "99" 不在候选列表范围内。

之前展示的候选作品：
1. 吹响吧！上低音号（2015）
2. 吹响吧！上低音号 第二季（2016）
3. 吹响吧！上低音号3（2024）

请输入 1-3 之间的数字，或描述您想选择的作品。
```

---

## 7. 实施步骤

### Phase 0: 准备工作 ✅
- [x] Commit当前代码
- [x] 创建`.env.example`模板
- [x] 创建新分支`feature/capstone-simplified`
- [x] 创建实施计划文档

### Phase 1: 清理不需要的组件

**任务**：
1. 删除agents：
   - `location_search_agent.py` 
   - `points_filtering_agent.py`
   - `route_agent.py`
   - `transport_agent.py`
   - `weather_agent.py`

2. 删除旧workflow：
   - `pilgrimage_workflow.py`

3. 更新`_schemas.py`：
   - 删除：`LocationResult`, `Route`, `RouteSegment`, `TransportInfo`
   - 保留：`ExtractionResult`
   - 新增：`BangumiCandidate`, `BangumiCandidatesResult`, `UserSelectionResult`, `RoutePlan`

**验收标准**：
- 代码库无编译错误
- 只保留必要的agents

### Phase 2: 创建Workflows

**任务**：
1. 创建`_workflows/bangumi_search_workflow.py`
   - Sequential: ExtractionAgent → BangumiCandidatesAgent

2. 创建`_workflows/route_planning_workflow.py`
   - Sequential: UserSelectionAgent → ParallelDataFetch → RoutePlanningAgent
   - ParallelAgent: PointsSearchAgent ‖ ContextEnrichmentAgent

3. 修改`agent.py`
   - 更新Root Agent的instruction（条件路由逻辑）
   - 配置DatabaseSessionService

**验收标准**：
- Workflows可以import
- Root agent有明确的条件路由逻辑

### Phase 3: 创建/修改Agents

**任务**：
1. 保留并确认`extraction_agent.py`正常工作

2. 修改`bangumi_search_agent.py` → `bangumi_candidates_agent.py`
   - 改为Sequential嵌套结构
   - 添加CandidatesFormatter sub-agent

3. 创建`user_selection_agent.py`
   - LlmAgent，解析用户选择

4. 修改`points_search_agent.py` ✨
   - 保持为BaseAgent
   - **关键修改**：output_key改为"all_points"
   - 移除任何距离过滤逻辑
   - 返回所有Anitabi点位（不截取）

5. 创建`points_selection_agent.py` ✨ NEW
   - **LlmAgent，核心优化**
   - 智能选择8-12个最佳点位
   - 考虑地理合理性、剧情重要性、游览可行性
   - Output schema: PointsSelectionResult
   - Output key: "points_selection_result"

6. 创建`route_planning_agent.py`
   - LlmAgent with plan_route_tool
   - **修改**：读取points_selection_result.selected_points

**验收标准**：
- 所有agents可以初始化
- Schema定义正确（特别是PointsSelectionResult）
- PointsSelectionAgent能正确从all_points中选择

### Phase 4: 创建Custom Tools

**任务**：
1. 创建`tools/bangumi_search.py`
   - `search_bangumi_subjects()` 函数
   - FunctionTool wrapper

2. 创建`tools/route_planning.py`
   - `plan_route()` 函数
   - FunctionTool wrapper

3. 创建`services/simple_route_planner.py`
   - SimpleRoutePlanner类
   - 基于剧集顺序排序
   - 生成模板化文本

**验收标准**：
- Tools可以独立调用
- 返回格式符合schema

### Phase 5: Session配置与测试

**任务**：
1. 配置DatabaseSessionService
   - 在`agent.py`中初始化
   - 配置SQLite路径
   - 启用SQL logging

2. 创建测试脚本`tests/test_session_persistence.py`
   - 测试invocation 1保存state
   - 测试invocation 2读取state
   - 验证跨invocation访问

3. 端到端测试
   - 完整的两轮对话流程
   - 验证state正确持久化

**验收标准**：
- Session state正确保存到数据库
- 第二轮可以读取第一轮的候选列表

### Phase 6: Observability强化

**任务**：
1. 在所有agents中添加structlog日志
   - Start/End事件
   - 关键数据点
   - 错误日志

2. 添加duration追踪
   - 每个agent的执行时间
   - 整体workflow时间

3. Event tracing
   - 确保所有BaseAgent正确yield Event
   - Event.actions.escalate设置合理

**验收标准**：
- 日志完整覆盖workflow
- 便于调试和观察

### Phase 7: 文档与演示

**任务**：
1. 更新`README.md`
   - 项目介绍（符合Capstone评分标准）
   - 核心概念映射
   - Setup instructions
   - 使用示例

2. 创建架构图
   - `docs/architecture_diagram.png`（或ASCII art）
   - 数据流图
   - State transition图

3. 创建`WRITEUP.md`（Capstone提交文档）
   - Problem statement
   - Solution overview
   - Architecture description
   - ADK concepts demonstrated
   - Demo screenshots

4. （可选）录制YouTube视频
   - 3分钟以内
   - 包括：Problem, Agents, Architecture, Demo, Build process

**验收标准**：
- README清晰易懂
- 架构图准确
- WRITEUP符合提交要求

### Phase 8: 部署（Bonus）

**任务**：
1. 创建Cloud Run部署配置
   - `deploy/Dockerfile`
   - `deploy/cloudbuild.yaml`
   - 环境变量管理

2. 部署到Cloud Run
   - 配置服务账号
   - 设置环境变量
   - 测试endpoint

3. 文档化部署流程
   - `docs/deployment.md`

**验收标准**：
- 成功部署到Cloud Run
- Endpoint可访问
- 部署文档完整

---

## 8. 测试策略

### 8.1 单元测试

**测试文件**：`tests/unit/`

```python
# tests/unit/test_extraction_agent.py
def test_extraction_agent():
    """测试ExtractionAgent提取能力"""
    # Mock InvocationContext
    # 验证能正确提取bangumi_name和location

# tests/unit/test_user_selection_agent.py
def test_user_selection_parsing():
    """测试用户选择解析"""
    # 测试数字输入："1", "2"
    # 测试描述输入："第一个", "2015年的"

# tests/unit/test_simple_route_planner.py
def test_route_generation():
    """测试路线生成逻辑"""
    # 验证点位排序
    # 验证描述生成
```

### 8.2 工具测试

```python
# tests/unit/test_tools.py
def test_search_bangumi_subjects_tool():
    """测试Bangumi搜索工具"""
    result = search_bangumi_subjects("京吹", max_results=3)
    assert "candidates" in result
    assert len(result["candidates"]) <= 3

def test_plan_route_tool():
    """测试路线规划工具"""
    points = [...]  # Mock points
    result = plan_route("宇治", "响", points)
    assert "recommended_order" in result
    assert "route_description" in result
```

### 8.3 集成测试

```python
# tests/integration/test_workflows.py
async def test_stage1_workflow():
    """测试Stage 1完整流程"""
    # Mock session with user_query
    # Execute bangumi_search_workflow
    # 验证state包含bangumi_candidates

async def test_stage2_workflow():
    """测试Stage 2完整流程"""
    # Mock session with bangumi_candidates
    # Execute route_planning_workflow
    # 验证state包含route_plan
```

### 8.4 端到端测试

```python
# tests/e2e/test_full_conversation.py
async def test_two_round_conversation():
    """测试完整的两轮对话"""
    
    # Round 1
    session = create_test_session()
    response1 = await root_agent.run(
        session=session,
        user_input="我在宇治 想去巡礼京吹"
    )
    assert "请选择" in response1
    assert len(session.state["bangumi_candidates"]["candidates"]) > 0
    
    # Persist session
    session_id = session.session_id
    
    # Round 2
    session2 = load_session(session_id)  # Load from database
    response2 = await root_agent.run(
        session=session2,
        user_input="选择1"
    )
    assert "路线" in response2
    assert "route_plan" in session2.state
```

### 8.5 Session持久化测试

```python
# tests/integration/test_session_persistence.py
async def test_cross_invocation_state():
    """测试跨invocation的state访问"""
    
    # Invocation 1
    session = SessionService.create_session(user_id="test_user")
    session.state["test_key"] = "test_value"
    await SessionService.save(session)
    
    session_id = session.session_id
    
    # Invocation 2
    loaded_session = await SessionService.load(session_id)
    assert loaded_session.state["test_key"] == "test_value"
```

---

## 9. 评分优化策略

### 9.1 Technical Implementation (50分)

**策略**：
1. **代码质量**：
   - 清晰的注释，标注核心概念
   - 遵循ADK最佳实践
   - 适当的错误处理

2. **核心概念展示**：
   - 在关键代码位置添加注释：`# ✅ 核心概念X: ...`
   - README中创建"核心概念映射表"
   - 每个概念都有具体代码示例

3. **有意义的agent使用**：
   - 每个agent都有明确的职责
   - 避免过度工程化
   - 展示agent组合的价值

**代码注释示例**：
```python
# ✅ 核心概念 1: Multi-agent system - SequentialAgent
# This workflow demonstrates sequential agent composition, where
# ExtractionAgent's output feeds into BangumiCandidatesAgent
bangumi_search_workflow = SequentialAgent(
    name="BangumiSearchWorkflow",
    sub_agents=[extraction_agent, bangumi_candidates_agent]
)

# ✅ 核心概念 3: Sessions & State Management
# DatabaseSessionService ensures state persistence across invocations,
# enabling multi-turn conversations where the second invocation can
# access candidates from the first invocation
session_service = DatabaseSessionService(
    database_url="sqlite:///./data/sessions.db"
)
```

### 9.2 Documentation (20分)

**README.md结构**：
```markdown
# Seichijunrei - Anime Pilgrimage Planning Assistant

## Problem Statement
[描述用户痛点]

## Solution
[描述agent如何解决问题]

## Architecture
[插入架构图]

### ADK Core Concepts Demonstrated
1. **Multi-agent System**
   - 2 SequentialAgents
   - 1 ParallelAgent
   - 5 LlmAgents
   - 1 BaseAgent
   - Code: `_workflows/*.py`, `_agents/*.py`

2. **Custom Tools**
   - search_bangumi_subjects
   - plan_route
   - Code: `tools/*.py`

...

## Setup Instructions
[详细安装步骤]

## Usage Example
[完整对话示例]

## Project Structure
[文件树]
```

**架构图建议**：
- 使用draw.io或Lucidchart
- 包含：agents层次、数据流、state管理
- 导出为PNG嵌入README

### 9.3 The Pitch (30分)

**WRITEUP.md结构**：

```markdown
# Seichijunrei: Intelligent Anime Pilgrimage Assistant

## Core Concept & Value (15分)

### Problem
动漫巡礼爱好者面临三大挑战：
1. 巡礼点信息分散难找
2. 不知道合理的游览顺序
3. 缺乏交通和时间规划

### Solution  
Seichijunrei leverages ADK's multi-agent architecture to provide:
- Natural conversational interface
- Intelligent bangumi search with disambiguation
- Personalized route planning

### Innovation
首个结合Bangumi和Anitabi的AI规划助手，充分展示ADK的：
- Multi-agent orchestration
- State-persistent multi-turn conversations
- Custom tool integration

## Writeup (15分)

### Architecture Overview
[详细架构说明]

### Why Agents?
Agents uniquely solve this problem because:
1. **Sequential workflow** models natural planning process
2. **Parallel agents** optimize API calls
3. **State management** enables natural multi-turn UX
4. **Custom tools** integrate domain-specific data sources

### Development Journey
[实施过程，challenges, learnings]

### Demo
[Screenshots of actual conversation]
```

### 9.4 Bonus Points策略

| Bonus项 | 分值 | 策略 |
|---------|------|------|
| **Use Gemini** | 5分 | ✅ 所有LlmAgents使用`gemini-2.0-flash`<br>在README和代码中明确标注 |
| **Deployment** | 5分 | ✅ 部署到Cloud Run<br>提供deployment.md文档<br>在WRITEUP中包含deployment evidence |
| **YouTube Video** | 10分 | ⚠️ 可选<br>3分钟视频包含：Problem → Why Agents → Architecture → Demo → Build |

**YouTube视频脚本**（如果制作）：
```
[0:00-0:30] Problem Statement
  - 展示传统巡礼规划的痛点
  - 数据分散、难以规划

[0:30-1:00] Why Agents?
  - 展示架构图
  - 说明multi-agent如何解决问题

[1:00-1:30] Architecture Deep Dive
  - Sequential workflow
  - Parallel data fetching
  - State persistence

[1:30-2:30] Live Demo
  - 实际对话演示
  - 展示两轮交互
  - 展示生成的路线

[2:30-3:00] Build & Tech Stack
  - ADK核心概念
  - Gemini 2.0 Flash
  - Cloud Run deployment
```

---

## 10. 附录

### 10.1 技术栈清单

| 组件 | 技术选型 | 用途 |
|------|---------|------|
| **Framework** | Google ADK (Python) | Multi-agent orchestration |
| **LLM** | Gemini 2.0 Flash | Agent reasoning |
| **Session Store** | SQLite / PostgreSQL | State persistence |
| **API Clients** | httpx, aiohttp | External API calls |
| **Logging** | structlog + rich | Observability |
| **Testing** | pytest + pytest-asyncio | Unit/Integration tests |
| **Deployment** | Cloud Run | Production hosting |

### 10.2 API依赖

| API | 用途 | 需要Key? | 文档 |
|-----|------|----------|------|
| **Bangumi** | 搜索动漫作品 | ❌ No | https://bangumi.github.io/api/ |
| **Anitabi** | 获取巡礼点位 | ❌ No | https://api.anitabi.cn/ |
| **Gemini** | LLM推理 | ✅ Yes | https://ai.google.dev/gemini-api/docs |

### 10.3 目录结构

```
Seichijunrei/
├── adk_agents/
│   └── seichijunrei_bot/
│       ├── __init__.py
│       ├── agent.py                    # Root agent + session config
│       ├── _agents/
│       │   ├── extraction_agent.py
│       │   ├── bangumi_candidates_agent.py
│       │   ├── user_selection_agent.py
│       │   ├── points_search_agent.py
│       │   ├── context_enrichment_agent.py
│       │   └── route_planning_agent.py
│       ├── _workflows/
│       │   ├── bangumi_search_workflow.py
│       │   └── route_planning_workflow.py
│       ├── _schemas.py
│       └── tools/
│           ├── bangumi_search.py
│           └── route_planning.py
├── clients/
│   ├── bangumi.py
│   └── anitabi.py
├── services/
│   └── simple_route_planner.py
├── utils/
│   └── logger.py
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── docs/
│   ├── capstone_implementation_plan.md  # 本文档
│   ├── architecture.md
│   ├── architecture_diagram.png
│   └── deployment.md
├── deploy/
│   ├── Dockerfile
│   └── cloudbuild.yaml
├── data/
│   └── sessions.db                      # SQLite database
├── .env.example
├── README.md
├── WRITEUP.md                           # Capstone submission
└── requirements.txt
```

### 10.4 时间估算

| Phase | 任务 | 估算时间 |
|-------|------|---------|
| 0 | 准备工作 | 0.5天 ✅ |
| 1 | 清理代码 | 0.5天 |
| 2 | 创建Workflows | 0.5天 |
| 3 | 创建Agents | 1天 |
| 4 | 创建Tools | 0.5天 |
| 5 | Session配置与测试 | 1天 |
| 6 | Observability | 0.5天 |
| 7 | 文档 | 1天 |
| 8 | 部署（Bonus） | 0.5天 |
| **总计** | | **5-6天** |

**关键里程碑**：
- Day 2: 基础架构完成，可以运行简单对话
- Day 3: 完整两轮对话功能
- Day 4: 测试和优化
- Day 5: 文档和演示准备
- Day 6: 部署和最终polish

### 10.5 风险管理

| 风险 | 影响 | 可能性 | 缓解措施 |
|------|------|--------|---------|
| DatabaseSessionService配置问题 | 高 | 中 | 先用InMemorySessionService测试逻辑 |
| LLM未能正确解析用户选择 | 中 | 中 | 添加few-shot examples，fallback逻辑 |
| Anitabi API返回空数据 | 高 | 低 | 错误处理，友好提示用户 |
| 时间不足完成部署 | 低 | 中 | 部署是bonus，不影响核心评分 |
| 代码复杂度过高 | 中 | 低 | 遵循KISS原则，保持简洁 |

### 10.6 参考资料

1. **ADK官方文档**
   - [Multi-Agent Systems](https://google.github.io/adk-docs/agents/multi-agents/)
   - [State Management](https://google.github.io/adk-docs/sessions/state/)
   - [Resume Agents](https://google.github.io/adk-docs/runtime/resume/)

2. **Capstone要求**
   - Kaggle Competition Page
   - 评分标准 rubric

3. **API文档**
   - [Bangumi API](https://bangumi.github.io/api/)
   - [Gemini API](https://ai.google.dev/gemini-api/docs)

4. **项目内部文档**
   - `docs/architecture.md`
   - `docs/adk_migration_spec.md`
   - `docs/adk_user_interaction_research.md`

---

**文档版本**：v1.0  
**最后更新**：2025-11-29  
**作者**：Development Team  
**状态**：✅ Ready for Implementation

---

*This implementation plan is designed to maximize Capstone scoring while building a functional, well-architected ADK application. Follow the phases sequentially, testing each component thoroughly before proceeding to the next.*
