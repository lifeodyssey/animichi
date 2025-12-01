# Seichijunrei Bot: AI-Powered Anime Location Tourism Assistant

**Track**: Concierge Agents

**Author**: Zhenjia Zhou

**Repository**: https://github.com/lifeodyssey/Seichijunrei-bot

---

## Problem Statement

### What is Seichijunrei (聖地巡礼)?

Seichijunrei (聖地巡礼), literally "sacred place pilgrimage," is a Japanese cultural phenomenon where anime fans travel to real-world locations that appear in their favorite shows. For example, fans of *Sound! Euphonium* visit Uji City in Kyoto Prefecture to see the bridges and schools featured in the anime. This form of location-based tourism has become increasingly popular worldwide, with fans traveling from China, Southeast Asia, Europe, and the Americas to visit these iconic spots in Japan.

![Seichijunrei Example: Fans visiting the famous stairs from Your Name](https://image1.gamme.com.tw/news2/2016/04/82/qZqYpJ_ekKWcrKQ.jpg)

*Example: Fans recreating iconic scenes from "Your Name" (君の名は) at Suga Shrine stairs in Tokyo*



### The Problem

Planning a seichijunrei trip is surprisingly complex and time-consuming:

1. **Information Fragmentation**: Location data is scattered across Japanese websites, fan wikis, and social media with no centralized database accessible to international fans.

2. **Language Barriers**: Resources are Japanese-only. Fans struggle to search by localized titles (e.g., "Sound! Euphonium" vs "響け！ユーフォニアム") and navigate Japanese services.

3. **Information Overload**: Popular anime have 50-200+ locations. Which spots are worth visiting? Which fit a one-day trip? Which are publicly accessible?

4. **Route Optimization**: Travelers must optimize visiting order considering geography, transportation, hours, and narrative flow.

5. **Manual Research**: Fans spend 10-20 hours planning a single-day itinerary.

### Why This Matters

As anime becomes global, making Japanese location tourism accessible bridges cultural gaps and supports regional economies. Automating planning democratizes this experience for international fans.

---

## Why Agents?

### The Case for Multi-Agent Architecture

Seichijunrei trip planning is a perfect use case for AI agents because it requires:

**1. Conversational Intelligence**
Users describe intent ambiguously ("visit gbc locations near Kawasaki"). The system must understand abbreviations, clarify ambiguous matches, and handle multilingual queries. This requires **natural language understanding and multi-turn dialogue** that agents excel at.

**2. Complex Decision-Making**
Given 50+ locations, the system must select 8-12 optimal spots considering geography, plot importance, accessibility, and transportation. **LLM-powered agents can reason** about these trade-offs holistically versus hundreds of hardcoded rules.

**3. Multi-Stage Workflow**
The process naturally divides into sequential stages:
- **Stage 1**: Search and disambiguate the anime
- **Stage 2**: Select locations and generate optimized routes

Each stage has multiple sub-tasks (extract query → search → format → present). **Agent composition patterns** (sequential agents, conditional routing) elegantly model this workflow.

**4. Stateful Conversation**
The system must remember:
- Which anime candidates were presented
- Which one the user selected
- The user's starting location and language preference

**Session management** is critical for maintaining conversation context across multiple turns.


---

## What I Created

### Overall Architecture

Seichijunrei Bot is built using **Google's Agent Development Kit (ADK)** with a multi-agent orchestration pattern. The architecture consists of:

```
Root Agent (Conditional Router with LLM)
│
├─── Stage 1: BangumiSearchWorkflow (SequentialAgent)
│    ├── ExtractionAgent (LlmAgent)
│    │   └── Extracts: user language, anime name, start location
│    ├── BangumiCandidatesAgent (SequentialAgent)
│    │   ├── BangumiSearcher (LlmAgent + search tool)
│    │   └── CandidatesFormatter (LlmAgent + structured output)
│    └── UserPresentationAgent (LlmAgent)
│        └── Returns natural language presentation to user
│
└─── Stage 2: RoutePlanningWorkflow (SequentialAgent)
     ├── UserSelectionAgent (LlmAgent)
     │   └── Confirms user's anime selection
     ├── PointsSearchAgent (BaseAgent + API tool)
     │   └── Fetches all seichijunrei points from Anitabi API
     ├── PointsSelectionAgent (LlmAgent)
     │   └── Intelligently selects 8-12 optimal points using LLM reasoning
     ├── RoutePlanningAgent (LlmAgent + route tool)
     │   └── Generates optimized visiting order and route description
     └── RoutePresentationAgent (LlmAgent)
         └── Returns final route plan in user's language
```

### Key Design Patterns

**1. Sequential Agent Composition**
Both workflows use ADK's `SequentialAgent` to chain agents together. Output from one agent flows as input to the next via session state.

**2. Automatic Workflow Routing**
The root agent acts as a pure router, examining session state to automatically trigger workflows:
- If no `bangumi_candidates` exist → Stage 1 (search anime and present candidates)
- If `bangumi_candidates` exist → Stage 2 (parse selection and plan route automatically)

**3. Tool/Schema Separation**
ADK best practice: agents with `tools` shouldn't have `output_schema` (structured output). We separate concerns:
- `BangumiSearcher` calls search tools, outputs raw results
- `CandidatesFormatter` transforms raw data into structured JSON

**4. Presentation Layer Pattern**
Final presentation agents have **no output_schema**—they generate free-form natural language responses directly shown to users. This decouples data processing from UX.

### ADK Key Concepts Demonstrated

✅ **Multi-Agent System** (Sequential + Conditional routing)

✅ **Custom Tools** (4 FunctionTools: Bangumi search, Anitabi points lookup, route planning, translation)

✅ **Sessions & Memory** (InMemorySessionService for multi-turn conversation state)

✅ **Agent Evaluation** (Evaluation sets in `adk_agents/seichijunrei_bot/*.evalset.json`)

✅ **Deployment** (Vertex AI Agent Engine with auto-scaling)

✅ **Observability** (Structured logging with context, tracing enabled)


### Session State Flow

The system maintains conversation state across turns:

```
extraction_result (language, anime_name, location)
    ↓
bangumi_candidates (top 3-5 matching anime)
    ↓
selected_bangumi (user's confirmed choice)
    ↓
all_points (50-200 seichijunrei locations from API)
    ↓
points_selection_result (LLM-selected 8-12 optimal points)
    ↓
route_plan (optimized visiting order + descriptions)
```

---

## Demo

### Example Conversation Flow

**User Input** (Chinese):
```
我在川崎 想巡礼gbc
(I'm in Kawasaki, want to do seichijunrei for gbc)
```

**Bot Response** (Stage 1 - Candidate Presentation):
```
找到 1 部与 'gbc' 相关的动画作品，请选择：

1. **Girls Band Cry**（ガールズバンドクライ，2024-04）
   讲述了女子乐队在川崎的成长故事。

请回复数字（如 '1'）选择第一部作品。
```

**User Selection**:
```
1
```

**Bot Response** (Stage 2 - Intelligent Route, automatically triggered):
```
好的！为您规划《Girls Band Cry》（ガールズバンドクライ）的圣地巡礼路线。
从川崎出发，为您推荐以下行程：

推荐顺序：
1. 川崎駅東口 (Episode 1)
2. JR川崎駅 (Episode 1)
3. たちばな通 (Episode 4)
4. 銀座街 (Episode 4)
... [10 optimized locations]

行程详情：
- 预计时长：约 5.0 小时
- 预计距离：约 15.0 公里

交通提示：
利用火车和公共汽车等公共交通工具在各个地点之间穿梭。步行适合银座商业街区域。

特别提示：
- 提前查询商店和设施的营业时间
- 拍照时请尊重当地居民和商家
```

### Key Features Demonstrated

- **Multilingual Support**: Detected Chinese input, responded in Chinese, preserved Japanese location names
- **Intelligent Selection**: Chose 10 locations from 50+ available, clustered around Kawasaki Station
- **Narrative Ordering**: Locations grouped by episode (Episode 1 → Episode 4) for story immersion
- **Practical Guidance**: Duration/distance estimates, transportation tips, etiquette reminders

**Visual Demo**: See attached screenshot for full conversation interface.

---

## The Build

### Technologies & Frameworks

**Core Framework**:
- **Google ADK (Agent Development Kit) 1.0+**: Multi-agent orchestration, session management, tool integration
- **Gemini 2.0 Flash**: LLM powering all intelligent agents (reasoning, language understanding, translation)

**External APIs**:
- **Bangumi API** (bangumi.tv): Anime metadata search with 24-hour response caching
- **Anitabi API** (api.anitabi.cn): Seichijunrei location database with 1-hour caching

**Production Infrastructure**:
- **aiohttp**: Async HTTP client with automatic retry (exponential backoff), rate limiting (token-bucket), and LRU cache
- **Pydantic 2.0**: Type validation and schema enforcement for domain models
- **structlog**: Structured logging with contextual metadata

### Development Approach

**1. Domain-Driven Design**
Clean separation of concerns:
- `domain/entities.py`: Core models (Bangumi, Point, Route, Coordinates)
- `clients/`: HTTP clients with resilience patterns (retry, rate-limit, cache)
- `services/`: Business logic (SimpleRoutePlanner for heuristic optimization)
- `adk_agents/`: ADK agent definitions and workflows

**2. Resilience Patterns**
- **Retry Logic**: 3 retries with exponential backoff (1s → 2s → 4s), capped at 30s, with jitter
- **Rate Limiting**: 30 calls/60s per API client using token-bucket algorithm
- **Caching**: Bangumi (24h TTL), Anitabi (1h TTL), LRU eviction at 1000 entries

**3. Testing Strategy**
- **Unit Tests**: HTTP clients, domain models, caching, retry logic (15+ test files)
- **Integration Tests**: Presentation agents with multilingual output
- **Evaluation Sets**: Multiple `*.evalset.json` files for end-to-end conversation quality

**4. Multilingual Support**
- Language detection from user query (Chinese, English, Japanese)
- Gemini-powered translation tool for anime titles
- All responses generated in detected user language

### Deployment: Vertex AI Agent Engine

**Deployment to Vertex AI Agent Engine**:
- Platform: Google Vertex AI (us-central1)
- CI/CD: GitHub Actions with manual workflow dispatch
- Environments: staging / production
- Configuration: ADK default settings with auto-scaling

Full deployment guide available in `DEPLOYMENT.md`.

---

## If I Had More Time

### Priority Enhancements

**1. Google Maps Integration**
Replace heuristic route planning with real routing APIs:
- Actual travel times via public transit
- Turn-by-turn navigation links
- Real-time transit delays and alternatives

**2. PDF/Document Export**
Generate printable route guides:
- Map images with numbered waypoints
- Location photos and anime screenshots side-by-side
- QR codes linking to Google Maps

**3. Weather Integration**
Seasonal recommendations:
- Weather forecasts for travel dates
- Best seasons to visit (cherry blossoms, autumn foliage)
- Indoor alternative suggestions for rainy days

**4. Persistent Sessions**
Upgrade from in-memory to cloud-backed storage (Redis/Cloud Storage):
- Save partial itineraries
- Cross-device access (start on mobile, finish on desktop)
- History of past seichijunrei trips

**5. Community Features**
- User reviews and tips for each location
- Photo uploads (user-contributed images)
- Difficulty ratings (accessibility, crowding levels)

---


## Repository & Links

- **GitHub**: https://github.com/lifeodyssey/Seichijunrei-bot
- **Documentation**: See `README.md` for quickstart, `DEPLOYMENT.md` for deployment guide
- **Evaluation Sets**: `adk_agents/seichijunrei_bot/` directory contains evalset files

---

**Thank you for considering this submission!** 🎌
Let's make seichijunrei accessible to anime fans worldwide through the power of AI agents.
