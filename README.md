# Seichijunrei Bot

> An intelligent 聖地巡礼 (seichijunrei) travel assistant built on Google ADK

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Track: Concierge Agents](https://img.shields.io/badge/Track-Concierge%20Agents-blue)](https://www.kaggle.com/competitions/google-adk-capstone)

---

## Overview

Seichijunrei Bot is a conversational AI agent that helps anime fans plan
聖地巡礼 (seichijunrei) trips to real‑world locations featured in anime.

Through a natural 2-stage dialogue, the agent:

- **Stage 1**: Searches for anime by name and presents top candidates
- **Stage 2**: Intelligently selects 8-12 optimal 聖地巡礼 points using LLM reasoning
- Considers geography, plot importance, and accessibility
- Generates optimized routes with transport suggestions
- Creates interactive HTML maps and printable PDF guides

The project is implemented using the Google Agent Development Kit (ADK) with
Gemini 2.0 Flash for intelligent decision-making.

---

## Key Features

- **Conversational Search**
  - Natural language anime search via Bangumi API
  - Presents 3-5 top candidates with summaries
  - User-friendly selection through dialogue

- **LLM-Driven Intelligent Selection**
  - Gemini 2.0 Flash intelligently selects 8-12 optimal 聖地巡礼 points
  - Considers geographic clustering, plot importance, and accessibility
  - Balances route feasibility with content coverage

- **Automated Route Planning**
  - Narrative-order based route optimization
  - Estimates duration and distance
  - Transport recommendations

- **Rich Outputs**
  - Interactive Folium maps with color-coded markers
  - Professional PDF guides with itinerary and anime details
  - Session-based state management for multi-turn conversations

---

## Architecture (High Level)

The core workflow is implemented as a **2-stage conversational flow** using ADK agents:

### Stage 1: Bangumi Search Workflow
1. **ExtractionAgent (LlmAgent)**
   - Extracts `bangumi_name` and `location` from user query
   - Output: `extraction_result` → session state

2. **BangumiCandidatesAgent (SequentialAgent)**
   - Searches Bangumi API for matching anime works
   - Selects top 3-5 candidates
   - Output: `bangumi_candidates` → session state

3. **UserPresentationAgent (LlmAgent)**
   - Generates natural language presentation of candidates
   - No output_schema (conversational response)
   - User selects their preferred anime

### Stage 2: Route Planning Workflow
4. **UserSelectionAgent (LlmAgent)**
   - Confirms and normalizes user's anime selection
   - Output: `selected_bangumi` → session state

5. **PointsSearchAgent (BaseAgent)**
   - Fetches all 聖地巡礼 points from Anitabi API
   - Output: `all_points` → session state

6. **PointsSelectionAgent (LlmAgent)**
   - Intelligently selects 8-12 best points using LLM reasoning
   - Considers: geography, plot importance, accessibility
   - Output: `points_selection_result` → session state

7. **RoutePlanningAgent (LlmAgent)**
   - Calls custom `plan_route` tool for optimization
   - Generates final route with transport suggestions
   - Output: `route_plan` → session state

**State Management:**
- Uses `InMemorySessionService` for multi-turn conversations
- State keys flow through workflow stages
- Root agent (`seichijunrei_bot`) routes between stages based on state

**Supporting Layers:**
- **Domain layer** (`domain/`) – Pydantic entities: `Bangumi`, `Point`, `Route`, `PilgrimageSession`
- **Infrastructure** (`clients/`, `services/`) – HTTP clients, retry, cache, session management
- **Tools** (`tools/`) – Map and PDF generator tools exposed to agent
- **Templates** (`templates/`) – HTML/PDF layouts for user-facing outputs

---

## Getting Started

### Prerequisites

- Python 3.11+
- [`uv`](https://github.com/astral-sh/uv) for dependency management
- Google API Key with Gemini API access
- No additional API keys required (Bangumi and Anitabi APIs are public)

### 1. Install dependencies

```bash
uv sync
```

### 2. Configure environment

Create a `.env` file in the project root:

```bash
cp .env.example .env
```

Required configuration:

```env
GEMINI_API_KEY=your_gemini_api_key
ANITABI_API_URL=https://api.anitabi.cn
APP_ENV=development
LOG_LEVEL=INFO
DEBUG=false
```

### 3. Run the ADK web UI (recommended)

```bash
make dev      # first time only – installs tools
make web      # start ADK Web UI
```

or directly:

```bash
uv run adk web adk_agents
```

Then open the URL printed in the terminal (typically
`http://localhost:8000`) and chat with the agent.

### 4. Run from the command line

```bash
make run
# or
uv run adk run adk_agents/seichijunrei_bot
```

---

## Project Structure

```text
Seichijunrei/
├── README.md                # Overview (this file)
├── .env.example             # Environment template
├── pyproject.toml           # Project configuration
├── Makefile                 # Convenience commands
│
├── adk_agents/
│   └── seichijunrei_bot/
│       ├── agent.py              # ADK root agent entry point
│       ├── _agents/              # 9 agent implementations
│       │   ├── extraction_agent.py
│       │   ├── bangumi_candidates_agent.py
│       │   ├── bangumi_search_agent.py
│       │   ├── user_presentation_agent.py
│       │   ├── user_selection_agent.py
│       │   ├── points_search_agent.py
│       │   ├── points_selection_agent.py
│       │   ├── route_planning_agent.py
│       │   └── input_normalization_agent.py
│       ├── _schemas.py           # Pydantic schemas for ADK agents
│       ├── _workflows/           # 2 workflow orchestrations
│       │   ├── bangumi_search_workflow.py
│       │   └── route_planning_workflow.py
│       └── tools/                # Custom function tools
│           ├── __init__.py       # Bangumi/Anitabi API tools
│           └── route_planning.py # Route optimization tool
│
├── clients/                 # HTTP API clients
│   ├── anitabi.py           # Anitabi 聖地巡礼 data client
│   ├── bangumi.py           # Bangumi subject search client
│   └── base.py              # Base HTTP client
│
├── config/                  # Configuration management
│   └── settings.py          # Pydantic settings
│
├── domain/                  # Domain models
│   └── entities.py          # Core Pydantic entities
│
├── services/
│   ├── cache.py             # In‑memory cache helpers
│   ├── retry.py             # Retry and rate‑limiting utilities
│   ├── session.py           # Session state management
│   └── simple_route_planner.py  # Route planning service
│
├── tools/                   # Map/PDF generation tools
│   ├── map_generator.py     # Folium map generation
│   └── pdf_generator.py     # PDF generation
│
├── utils/                   # Utilities
│   └── logger.py            # Structured logging
│
├── templates/               # Jinja2 templates for PDF
│   ├── pdf_main.html
│   ├── pdf_itinerary.html
│   ├── pdf_bangumi.html
│   └── pdf_cover.html
│
└── tests/
    ├── unit/                # Unit tests
    └── integration/         # Integration tests
```

---

## Data Sources and APIs

- **Bangumi** (bangumi.tv) – Anime metadata and subject information
- **Anitabi** (api.anitabi.cn) – 聖地巡礼 location database
- **Google Gemini 2.0 Flash** – LLM for intelligent point selection and conversational AI

---

## License

This project is released under the MIT License (see `LICENSE`).

Built as a Google ADK Capstone Project in the "Concierge Agents" track.
