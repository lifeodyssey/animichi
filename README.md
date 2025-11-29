# Seichijunrei Bot

> An intelligent anime pilgrimage travel assistant built on Google ADK

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Track: Concierge Agents](https://img.shields.io/badge/Track-Concierge%20Agents-blue)](https://www.kaggle.com/competitions/google-adk-capstone)

---

## Overview

Seichijunrei Bot is a multi‑agent travel assistant that helps anime fans plan
“pilgrimage” trips to real‑world locations featured in anime.

Given a starting station (for example “Shinjuku Station” or “Akihabara
Station”), the agent:

- finds nearby anime pilgrimage spots from open data sources
- filters locations based on the shows the user cares about
- builds a route that avoids back‑tracking
- suggests transport options between each stop
- optionally fetches weather information
- generates an interactive HTML map and a printable PDF guide.

The project is implemented as a deterministic multi‑step workflow using the
Google Agent Development Kit (ADK).

---

## Key Features

- **Smart location search**
  - Resolve a station name to coordinates.
  - Find all nearby anime works and their key locations.

- **Personalised filtering**
  - Let the user choose which shows they have watched.
  - Keep only pilgrimage points from those works to avoid noise.

- **Route optimisation**
  - Greedy nearest‑neighbour route from the origin station.
  - Produces an ordered list of locations with cumulative distance and time.

- **Transport suggestions**
  - Uses Google Maps Directions API.
  - Recommends walking, subway or bus between each pair of points.

- **Weather and opening‑hours aware**
  - Integrates a weather API for basic conditions and recommendations.
  - Designed to plug in POI / opening‑hours enrichment.

- **Rich outputs**
  - Interactive Folium map for exploration.
  - Jinja2‑based PDF guide with itinerary, route summary and anime sections.

---

## Architecture (High Level)

The core workflow is implemented as a `SequentialAgent` with embedded
`ParallelAgent` stages:

1. **ExtractionAgent (LlmAgent)**
   - Extracts `bangumi_name` and `location` from the user query.
2. **ParallelSearch (ParallelAgent)**
   - **BangumiSearchAgent (LlmAgent)** – searches Bangumi for the best‑matching work.
   - **LocationSearchAgent (LlmAgent)** – resolves the station name to coordinates.
3. **PointsSearchAgent (BaseAgent)**
   - Calls the Anitabi API to fetch pilgrimage points for the selected work.
4. **PointsFilteringAgent (BaseAgent)**
   - Reduces the list to a manageable set for routing (for example, top N).
5. **ParallelEnrichment (ParallelAgent)**
   - **WeatherAgent (BaseAgent)** – fetches weather summary (optional).
   - **RouteOptimizationAgent (BaseAgent)** – builds the core route.
6. **TransportAgent (BaseAgent)**
   - Adds transport details and prepares the final plan.

The ADK workflow is defined in
`adk_agents/seichijunrei_bot/_workflows/pilgrimage_workflow.py` and used as the
root agent entry point (`adk_agents/seichijunrei_bot/agent.py`).

Supporting layers:

- **Domain layer** (`domain/`) – Pydantic entities such as `Bangumi`,
  `Point`, `Route`, `PilgrimageSession`.
- **Infrastructure** (`clients/`, `services/`) – HTTP clients, retry, cache,
  session management.
- **Tools** (`tools/`) – map and PDF generator tools exposed to the agent.
- **Templates** (`templates/`) – HTML/PDF layouts for user‑facing outputs.

For a deeper architectural write‑up, see `docs/architecture.md`.

---

## Getting Started

For full local setup instructions (API keys, environment variables, health
checks), see `LOCAL_SETUP.md`. The section below provides the short version.

### Prerequisites

- Python 3.11+
- [`uv`](https://github.com/astral-sh/uv) for dependency management
- A Google Cloud project with:
  - **Google Maps Geocoding API**
  - **Google Maps Directions API**
- Optional: an OpenWeatherMap API key for weather.

### 1. Install dependencies

```bash
uv sync
```

### 2. Configure environment

Create and edit a `.env` file in the project root:

```bash
cp .env.example .env
```

At minimum you must set:

```env
GOOGLE_MAPS_API_KEY=your_google_maps_key
ANITABI_API_URL=https://api.anitabi.cn/bangumi
APP_ENV=development
LOG_LEVEL=INFO
DEBUG=false
```

To enable weather:

```env
WEATHER_API_KEY=your_openweathermap_key
WEATHER_API_URL=https://api.openweathermap.org/data/2.5
```

Run a simple health check:

```bash
make health
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
├── LOCAL_SETUP.md           # Local setup and troubleshooting
├── LOGGING_GUIDE.md         # Structured logging guide
├── SPEC.md                  # Technical specification for the capstone
├── requirement.md           # Kaggle capstone requirements (reference)
├── pyproject.toml           # Project configuration
├── Makefile                 # Convenience commands
│
├── adk_agents/
│   └── seichijunrei_bot/
│       ├── agent.py         # ADK root agent entry point
│       ├── _agents/         # LlmAgent and BaseAgent implementations
│       ├── _schemas.py      # Pydantic schemas for ADK agents
│       ├── _workflows/      # Sequential/Parallel ADK workflows
│       └── tools.py         # ADK FunctionTool definitions
│
├── clients/                 # HTTP API clients
│   ├── anitabi.py           # Anitabi pilgrimage data client
│   ├── bangumi.py           # Bangumi subject search client
│   ├── google_maps.py       # Google Maps Directions/Geocoding
│   └── weather.py           # Weather API client
│
├── domain/
│   ├── entities.py          # Core domain models
│   └── llm_schemas.py       # Legacy LLM schemas (for reference)
│
├── services/
│   ├── cache.py             # In‑memory cache helpers
│   ├── retry.py             # Retry and rate‑limiting utilities
│   └── session.py           # Session state management
│
├── tools/
│   ├── base.py              # BaseTool wrapper
│   ├── map_generator.py     # Folium map generation
│   └── pdf_generator.py     # Playwright PDF generation
│
├── templates/               # Jinja2 templates
│   ├── pdf_main.html
│   ├── pdf_itinerary.html
│   ├── pdf_bangumi.html
│   └── pdf_cover.html
│
├── tests/
│   ├── unit/                # Unit tests (entities, clients, tools, agents)
│   └── integration/         # Integration tests (optional, API‑dependent)
│
└── docs/
    ├── architecture.md      # Detailed architecture notes
    └── adk_migration_spec.md# ADK migration spec and state shape
```

---

## Specs, Requirements and Logging

- `SPEC.md` – full technical spec used for the Google ADK capstone submission.
- `requirement.md` – copied Kaggle competition requirements and rubric.
- `LOGGING_GUIDE.md` – how to configure and interpret the structured logs.

---

## License and Credits

This project is released under the MIT License (see `LICENSE`).

Data sources and services:

- **Anitabi** – open anime pilgrimage database.
- **Google Maps Platform** – geocoding, directions and routing.
- **OpenWeatherMap** (or compatible API) – weather information.

This repository was built as a Google ADK Capstone Project in the
“Concierge Agents” track.
