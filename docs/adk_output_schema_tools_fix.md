# ADK output_schema + tools 冲突问题修复方案

## 问题概述

### 错误现象

在运行 Seichijunrei Bot 时，`LocationSearchAgent` 和 `BangumiSearchAgent` 在 `ParallelAgent` 中执行时出现 Pydantic ValidationError：

```
ValidationError: 1 validation error for LocationResult
  Invalid JSON: expected ident at line 1 column 2
  [type=json_invalid, input_value='I have already geocoded 宇治 and set the model response...', input_type=str]
```

同时导致 Eval 保存功能失败。

### 根本原因

这是 **ADK v1.18.0 的已知 bug** ([GitHub Issue #3413](https://github.com/google/adk-python/issues/3413))。

**技术细节**:
- ADK 官方文档和源码注释明确说明：`output_schema` **不能与 `tools` 共存**
- 当 LlmAgent 同时配置 `tools` 和 `output_schema` 时：
  1. LLM 成功调用工具（如 `geocode_location`）
  2. 工具返回正确的结果
  3. **但随后 LLM 输出解释性文本而非 JSON**
  4. Pydantic 验证失败，抛出 `json_invalid` 错误

**受影响的 Agents**:
1. `LocationSearchAgent` - 使用 `geocode_location` tool + `LocationResult` schema
2. `BangumiSearchAgent` - 使用 `search_bangumi_subjects` tool + `BangumiResult` schema

---

## ADK 官方约束

来自 ADK 源码 `llm_agent.py:311-317`:

```python
output_schema: Optional[type[BaseModel]] = None
"""The output schema when agent replies.

NOTE:
  When this is set, agent can ONLY reply and CANNOT use any tools, such as
  function tools, RAGs, agent transfer, etc.
"""
```

---

## 解决方案：Sequential Agent 拆分

### 设计原则

遵循 ADK 最佳实践，将"工具调用"和"结构化输出"职责分离：

```
原始模式 (❌ 违反约束):
LlmAgent(tools=[...], output_schema=...)

新模式 (✅ 符合 ADK 设计):
SequentialAgent(sub_agents=[
    LlmAgent(tools=[...]),         # Step 1: 调用工具
    LlmAgent(output_schema=...),   # Step 2: 格式化输出
])
```

---

## 实施方案

### Stage 1: LocationSearchAgent 改为 BaseAgent

**原因分析**:
- `LocationSearchAgent` 职责单一：调用 Google Maps Geocoding API
- **无需 LLM 判断** - 纯工具调用 + 数据转换
- 改为 `BaseAgent` 更高效、更可靠

**实施步骤**:

#### 1.1 创建新的 BaseAgent 实现

**文件**: `adk_agents/seichijunrei_bot/_agents/location_search_agent.py`

```python
"""ADK BaseAgent for resolving a location name to coordinates via Google Maps.

This agent uses the Google Maps Geocoding API to convert human-readable
location names (e.g., "Uji" or "Kyoto") into GPS coordinates.

NOTE: Refactored from LlmAgent to BaseAgent to avoid ADK output_schema + tools bug.
See docs/adk_output_schema_tools_fix.md for details.
"""

from google.adk.agents import BaseAgent
from google.adk.events.event import Event
from google.adk.agents.invocation_context import InvocationContext

from adk_agents.seichijunrei_bot.tools import geocode_location
from adk_agents.seichijunrei_bot._schemas import LocationResult, CoordinatesData
from utils.logger import get_logger


logger = get_logger(__name__)


class LocationSearchAgent(BaseAgent):
    """Resolves location names to GPS coordinates using Google Maps API.

    This agent:
    1. Reads the location field from session state (extraction_result)
    2. Calls the geocode_location tool
    3. Constructs a LocationResult object
    4. Saves it to session state under 'location_result' key

    This is a deterministic agent with no LLM involvement.
    """

    async def process_event(
        self,
        event: Event,
        ctx: InvocationContext
    ) -> Event:
        """Process the event and geocode the location.

        Args:
            event: The incoming event
            ctx: Invocation context with session state

        Returns:
            The same event (agent does not modify conversation)
        """
        try:
            # 1. Read extraction_result from state
            extraction_result = ctx.session.state.get("extraction_result")
            if not extraction_result:
                logger.error("extraction_result not found in session state")
                raise ValueError("extraction_result is required")

            location_name = extraction_result.get("location")
            if not location_name:
                logger.error("location field missing in extraction_result")
                raise ValueError("location field is required in extraction_result")

            logger.info("Geocoding location", location=location_name)

            # 2. Call geocode_location tool
            geocode_result = await geocode_location(location_name)

            if not geocode_result.get("success"):
                error_msg = geocode_result.get("error", "Unknown error")
                logger.error("Geocoding failed", error=error_msg)
                raise ValueError(f"Geocoding failed: {error_msg}")

            # 3. Construct LocationResult
            coords = geocode_result["coordinates"]
            location_result = LocationResult(
                station=None,  # This agent does not resolve station metadata
                user_coordinates=CoordinatesData(
                    latitude=coords["latitude"],
                    longitude=coords["longitude"]
                ),
                search_radius_km=5.0  # Default search radius
            )

            logger.info(
                "Location geocoded successfully",
                location=location_name,
                coordinates=coords,
            )

            # 4. Save to session state
            ctx.session.state["location_result"] = location_result.model_dump()

            return event

        except Exception as e:
            logger.error(
                "LocationSearchAgent failed",
                error=str(e),
                exc_info=True,
            )
            raise


# Export for use in workflow
location_search_agent = LocationSearchAgent(
    name="LocationSearchAgent",
    description="Resolves location names to GPS coordinates using Google Maps",
)
```

#### 1.2 更新 workflow 引用

**文件**: `adk_agents/seichijunrei_bot/_workflows/pilgrimage_workflow.py`

无需修改 - 导入和使用方式保持不变。

---

### Stage 2: BangumiSearchAgent 拆分为 SequentialAgent

**原因分析**:
- `BangumiSearchAgent` 需要**LLM 智能判断**：
  - 从多个候选中选择最佳匹配
  - 处理多季番剧、剧场版的歧义
  - 评估匹配置信度
- 必须保留 LLM 能力，因此不能改为 BaseAgent

**拆分策略**:

```
BangumiSearchAgent (原始)
└── 同时使用 tools + output_schema ❌

↓ 拆分为 ↓

BangumiSearchSequential (新)
├── Step 1: BangumiSearchToolAgent (LlmAgent)
│   ├── tools=[search_bangumi_subjects]
│   └── 输出：搜索结果列表
└── Step 2: BangumiSelectorAgent (LlmAgent)
    ├── output_schema=BangumiResult
    └── 输入：上一步的搜索结果
```

**实施步骤**:

#### 2.1 创建拆分后的 Agents

**文件**: `adk_agents/seichijunrei_bot/_agents/bangumi_search_agent.py`

```python
"""ADK SequentialAgent for searching Bangumi subjects and selecting the best match.

REFACTORED: Split into two LlmAgents to avoid ADK output_schema + tools bug.
See docs/adk_output_schema_tools_fix.md for details.
"""

from google.adk.agents import LlmAgent, SequentialAgent
from google.adk.tools import FunctionTool

from adk_agents.seichijunrei_bot.tools import search_bangumi_subjects
from adk_agents.seichijunrei_bot._schemas import BangumiResult


# Step 1: Search for bangumi candidates using the tool
_bangumi_search_tool_agent = LlmAgent(
    name="BangumiSearchTool",
    model="gemini-2.0-flash",
    instruction="""
    You are an anime search assistant. Your job is to search for anime (bangumi)
    using the Bangumi API.

    Workflow:
    1. Read the bangumi_name field from {extraction_result}.
    2. Call search_bangumi_subjects(keyword=bangumi_name) to get candidate works.
    3. Return the complete search results to the next agent for selection.

    IMPORTANT: Do NOT select a work yourself. Your only job is to search and
    return ALL candidates. The selection will be done by the next agent.

    Example:
      Input: {extraction_result: {bangumi_name: "吹响！上低音号"}}
      Action: Call search_bangumi_subjects("吹响！上低音号")
      Output: Explain that you found X candidates and list them briefly.
    """,
    tools=[FunctionTool(search_bangumi_subjects)],
    # No output_schema - we want free-form text output
)


# Step 2: Select the best match and format as BangumiResult
_bangumi_selector_agent = LlmAgent(
    name="BangumiSelector",
    model="gemini-2.0-flash",
    instruction="""
    You are an anime matching assistant. Your job is to select the most
    appropriate anime (bangumi) from a list of candidates.

    Context:
    - The previous agent has searched Bangumi and returned candidate works.
    - You must analyze those candidates and choose the single best match.

    Selection criteria:
    1. Title similarity (original Japanese title and localized titles)
    2. Relevance to the user's query
    3. If multiple seasons/movies exist, prefer:
       - First season (if no specific season mentioned)
       - TV series over movies (unless user asked for movie)

    Requirements:
    - If there is no reasonable candidate, set bangumi_id to null and
      bangumi_confidence to 0.
    - bangumi_confidence must be between 0 and 1:
      - 1.0: Perfect match (exact title)
      - 0.8-0.9: Very good match (synonym or common abbreviation)
      - 0.6-0.7: Good match (same series but different season)
      - 0.3-0.5: Possible match (similar title)
      - 0.0: No match

    Output format:
    - bangumi_id: The selected work's Bangumi subject ID (or null)
    - bangumi_title: Original Japanese title
    - bangumi_title_cn: Chinese title (if available)
    - bangumi_confidence: Match confidence score
    """,
    output_schema=BangumiResult,
    output_key="bangumi_result",
    # No tools - pure selection and formatting
)


# Export as SequentialAgent
bangumi_search_agent = SequentialAgent(
    name="BangumiSearchAgent",
    description="""
    Searches Bangumi for anime and selects the best matching work.

    This is a two-step process:
    1. Search Bangumi API for candidate works
    2. Select the most appropriate match and format as BangumiResult
    """,
    sub_agents=[
        _bangumi_search_tool_agent,
        _bangumi_selector_agent,
    ],
)
```

#### 2.2 更新 workflow 引用

**文件**: `adk_agents/seichijunrei_bot/_workflows/pilgrimage_workflow.py`

无需修改 - `bangumi_search_agent` 的接口保持不变。

---

## 测试验证

### 测试用例

使用原始测试输入：
```
我在宇治 想去巡礼京吹
```

### 预期行为

#### Stage 1: ExtractionAgent
```json
{
  "extraction_result": {
    "bangumi_name": "吹响！上低音号",
    "location": "宇治"
  }
}
```

#### Stage 2: ParallelSearch

**LocationSearchAgent (BaseAgent)**:
1. 读取 `extraction_result.location` = "宇治"
2. 调用 `geocode_location("宇治")`
3. 保存 `location_result`:
```json
{
  "station": null,
  "user_coordinates": {
    "latitude": 34.884513,
    "longitude": 135.799704
  },
  "search_radius_km": 5.0
}
```

**BangumiSearchAgent (SequentialAgent)**:

*Step 1: BangumiSearchToolAgent*
1. 读取 `extraction_result.bangumi_name` = "吹响！上低音号"
2. 调用 `search_bangumi_subjects("吹响！上低音号")`
3. LLM 输出：找到 N 个候选，列出候选列表

*Step 2: BangumiSelectorAgent*
1. 读取上一步的候选列表
2. LLM 选择最佳匹配（第一季）
3. 保存 `bangumi_result`:
```json
{
  "bangumi_id": 115908,
  "bangumi_title": "響け！ユーフォニアム",
  "bangumi_title_cn": "吹响吧！上低音号",
  "bangumi_confidence": 0.9
}
```

#### 后续流程

正常执行：
- PointsSearchAgent
- PointsFilteringAgent
- ParallelEnrichment
- TransportAgent

### 验证点

- ✅ LocationSearchAgent 正确解析地点并保存坐标
- ✅ BangumiSearchAgent 正确搜索并选择番剧
- ✅ ParallelAgent 中两个 agent 正常并发执行
- ✅ 无 Pydantic ValidationError
- ✅ Session state 包含正确的结构化数据
- ✅ Eval 保存功能正常工作

---

## 修改清单

### 文件变更

1. **修改**: `adk_agents/seichijunrei_bot/_agents/location_search_agent.py`
   - 从 `LlmAgent` 改为 `BaseAgent`
   - 实现 `process_event` 方法
   - 移除 `instruction`、`tools`、`output_schema` 参数

2. **修改**: `adk_agents/seichijunrei_bot/_agents/bangumi_search_agent.py`
   - 拆分为两个内部 `LlmAgent`
   - 使用 `SequentialAgent` 包装
   - 更新 instruction 以明确各自职责

3. **无需修改**: `adk_agents/seichijunrei_bot/_workflows/pilgrimage_workflow.py`
   - Agent 接口保持不变

### 依赖关系

无新增依赖。

---

## 优势与权衡

### 优势

1. **彻底解决 ADK bug**
   - 完全符合 ADK 设计约束
   - 消除 Pydantic ValidationError
   - 修复 Eval 保存功能

2. **提升性能**
   - LocationSearchAgent: 无 LLM 调用，响应更快
   - BangumiSearchAgent: 拆分后每步职责清晰，更易调试

3. **增强可维护性**
   - 单一职责原则 - 每个 agent 只做一件事
   - 更好的错误隔离
   - 更清晰的日志追踪

4. **保持 LLM 能力**
   - BangumiSearchAgent 仍使用 LLM 进行智能匹配
   - 匹配逻辑更透明（显式的选择步骤）

### 权衡

1. **Agent 数量增加**
   - BangumiSearchAgent: 1 → 3 agents (SequentialAgent + 2 sub-agents)
   - 但逻辑更清晰，值得

2. **轻微的延迟增加**
   - BangumiSearchAgent 需要两轮 LLM 调用
   - 但可通过并发优化（已在 ParallelSearch 中）

---

## 回滚方案

如果修复后出现意外问题：

```bash
# 回滚到当前版本
git restore adk_agents/seichijunrei_bot/_agents/location_search_agent.py
git restore adk_agents/seichijunrei_bot/_agents/bangumi_search_agent.py
```

---

## 后续优化建议

1. **缓存优化**
   - LocationSearchAgent: 缓存常见地点的坐标
   - BangumiSearchAgent: 缓存 Bangumi 搜索结果

2. **错误处理增强**
   - 为 BaseAgent 添加更详细的错误信息
   - 实现重试逻辑

3. **性能监控**
   - 添加 metrics 跟踪各 agent 的执行时间
   - 监控 Bangumi API 调用次数

---

## 参考资料

- [ADK 官方文档 - LLM Agents](https://google.github.io/adk-docs/agents/llm-agents/)
- [ADK 官方文档 - Callbacks](https://google.github.io/adk-docs/callbacks/)
- [GitHub Issue #701 - Structured Output + Tool Call](https://github.com/google/adk-python/issues/701)
- [GitHub Issue #3413 - Agent with output_schema + tools infinite loop](https://github.com/google/adk-python/issues/3413)
- ADK 源码: `google/adk/agents/llm_agent.py:311-317`

---

## 实施时间表

| Stage | 任务 | 预计时间 |
|-------|------|---------|
| 1 | 重构 LocationSearchAgent | 30 分钟 |
| 2 | 重构 BangumiSearchAgent | 45 分钟 |
| 3 | 本地测试验证 | 30 分钟 |
| 4 | 文档更新 | 15 分钟 |
| **总计** | | **2 小时** |

---

**最后更新**: 2025-11-29
**作者**: Claude Code
**状态**: 待实施
