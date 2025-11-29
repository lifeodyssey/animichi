# Seichijunrei Bot – ADK Architecture

> Design notes for the deterministic multi‑agent workflow

_Last updated: 2024‑11‑29 (content converted to English and simplified)._

---

## 1. High‑Level Architecture

Seichijunrei Bot is built around a deterministic workflow using Google ADK:

- `SequentialAgent` orchestrates the overall pilgrimage planning flow.
- `ParallelAgent` is used for stages that can safely run in parallel
  (anime search + location resolution, weather + route optimisation).
- All state is carried in `ctx.session.state` and mirrored into domain models
  where needed.

### 1.1 Layered view

```text
┌─────────────────────────────────────────────────────┐
│ Layer 1: Root Agent (user interaction)              │
│  - seichijunrei_bot (SequentialAgent)              │
│  - Understands user intent and drives the workflow │
└────────────────┬────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────┐
│ Layer 2: Workflow Orchestration                     │
│  - Pilgrimage workflow (SequentialAgent)           │
│  - 6 deterministic stages                          │
│  - 2 ParallelAgent groups                          │
└────────────────┬────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────┐
│ Layer 3: Specialized Agents                        │
│  - LlmAgents for extraction and search             │
│  - BaseAgents for “real work” (I/O + business)     │
└────────────────┬────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────┐
│ Layer 4: Infrastructure & Domain                   │
│  - API clients (Anitabi, Bangumi, Maps, Weather)   │
│  - Services (cache, retry, rate limiting, session) │
│  - Domain entities (Pydantic models)               │
└─────────────────────────────────────────────────────┘
```

---

## 2. Workflow Design

The core workflow is defined in
`adk_agents/seichijunrei_bot/_workflows/pilgrimage_workflow.py` and exposed as
the root agent in `adk_agents/seichijunrei_bot/agent.py`.

### 2.1 Steps (sequential + parallel)

```python
from google.adk.agents import ParallelAgent, SequentialAgent

pilgrimage_workflow = SequentialAgent(
    name="seichijunrei_bot",
    sub_agents=[
        extraction_agent,        # Step 1: extract anime title + location
        parallel_search,         # Step 2: resolve bangumi + location in parallel
        points_search_agent,     # Step 3: fetch pilgrimage points
        points_filtering_agent,  # Step 4: filter/reduce points
        parallel_enrichment,     # Step 5: weather + route optimisation
        transport_agent,         # Step 6: add transport and final plan
    ],
)
```

Where:

```python
parallel_search = ParallelAgent(
    name="ParallelSearch",
    sub_agents=[bangumi_search_agent, location_search_agent],
)

parallel_enrichment = ParallelAgent(
    name="ParallelEnrichment",
    sub_agents=[weather_agent, route_optimization_agent],
)
```

This design:

- keeps ordering deterministic
- constrains side effects to well‑defined stages
- allows parallel I/O where safe (network calls to different services).

---

## 3. Agent Breakdown

### 3.1 LlmAgents

Located under `adk_agents/seichijunrei_bot/_agents/`.

#### ExtractionAgent

- **File**: `_agents/extraction_agent.py`
- **Type**: `LlmAgent`
- **Goal**: extract `bangumi_name` and `location` from natural language.
- **Output schema**: `ExtractionResult` (see `_schemas.py`).
- **Writes to state**: `extraction_result`, plus convenience fields via schema.

#### BangumiSearchAgent

- **File**: `_agents/bangumi_search_agent.py`
- **Type**: `LlmAgent` with `search_bangumi_subjects` tool.
- **Goal**: choose the best‑matching anime (Bangumi subject) for the query.
- **Writes to state**: `bangumi_result`, `bangumi_id`, `bangumi_title`,
  `bangumi_title_cn`, `bangumi_confidence`.

#### LocationSearchAgent

- **File**: `_agents/location_search_agent.py`
- **Type**: `LlmAgent` with `search_anitabi_bangumi_near_station` tool.
- **Goal**: resolve station name to coordinates and city/prefecture.
- **Writes to state**: `location_result`, `station`, `user_coordinates`,
  `search_radius_km`.

> All three LlmAgents use Pydantic `output_schema` models from
> `_schemas.py`, which ensures structured outputs and simplifies downstream
> access.

### 3.2 BaseAgents

These are non‑LLM agents that perform most of the I/O and deterministic logic.
They do not live in `adk_agents/` in this repo, but their behaviour is
implemented using:

- `clients/` – external HTTP APIs
- `domain/entities.py` – core models
- `services/` – low‑level utilities (retry, cache, session).

Key responsibilities:

- **PointsSearchAgent** – translate `bangumi_id` and `user_coordinates` into
  a list of nearby pilgrimage points using `AnitabiClient`.
- **PointsFilteringAgent** – keep a manageable subset of points (for example
  top 20 by distance) to avoid degenerate routes.
- **RouteOptimizationAgent** – apply a greedy nearest‑neighbour algorithm to
  compute the visit order, total distance and duration.
- **TransportAgent** – call Google Maps Directions API for each pair of
  consecutive stops and attach transport details to the route segments.
- **WeatherAgent** – fetch weather data and normalise it into a compact
  `Weather` entity.

The concrete BaseAgent implementations are thin wrappers over these
infrastructure functions and live in the ADK layer of the project.

---

## 4. Session State and Schemas

The workflow relies on a shared state dictionary
(`ctx.session.state: dict[str, Any]`) that is:

- populated incrementally by each stage
- compatible with domain entities (Pydantic models)
- documented in `docs/adk_migration_spec.md`.

Key groups of fields:

- **Extraction**
  - `user_query`
  - `bangumi_name`
  - `location`
  - `extraction_result`
- **Bangumi resolution**
  - `bangumi_candidates`
  - `bangumi_id`
  - `bangumi_title`
  - `bangumi_title_cn`
  - `bangumi_confidence`
- **Location / coordinates**
  - `station` (station name, city, prefecture, coordinates)
  - `user_coordinates`
  - `search_radius_km`
- **Points**
  - `points` (list of Point‑like dicts)
  - `points_filtered`
  - `points_meta`
- **Weather**
  - `weather`
  - `weather_raw`
- **Route & transport**
  - `route` (serialised `Route` entity)
  - `route_meta`
  - `final_plan` – LLM‑friendly projection of the final result.

`adk_agents/seichijunrei_bot/_schemas.py` defines the Pydantic models that
LlmAgents output, ensuring that JSON produced by the LLM is always
well‑structured and type‑checked before reaching downstream agents.

---

## 5. Infrastructure Layer

### 5.1 API clients (`clients/`)

- `AnitabiClient` (`clients/anitabi.py`)
  - Fetches anime works and pilgrimage points near a station.
- `BangumiClient` (`clients/bangumi.py`)
  - Searches and retrieves anime subjects from Bangumi.
- `GoogleMapsClient` (`clients/google_maps.py`)
  - Geocoding and Directions API wrapper.
- `WeatherClient` (`clients/weather.py`)
  - Normalised weather data from an external API.

All clients share common HTTP behaviour from `clients/base.py`:

- async requests with `httpx`
- retry and rate limiting using `services/retry.py`
- optional in‑memory caching.

### 5.2 Domain entities (`domain/`)

`domain/entities.py` defines:

- value objects such as `Coordinates`
- core entities: `Bangumi`, `Point`, `Route`, `PilgrimageSession`, `Weather`
- domain‑level exceptions.

These models are used consistently across:

- API clients
- tools (`MapGeneratorTool`, `PDFGeneratorTool`)
- ADK agents that operate on a `PilgrimageSession`.

### 5.3 Tools (`tools/`)

- `MapGeneratorTool` – builds interactive Folium maps and saves them to
  `output/maps/`.
- `PDFGeneratorTool` – renders Jinja2 templates via Playwright to produce
  PDFs in `output/pdfs/`.

Both are registered as ADK `FunctionTool`s in
`adk_agents/seichijunrei_bot/agent.py`, so they can be called by agents or
external orchestrations.

---

## 6. Observability

Logging is configured in `utils/logger.py` and documented in
`LOGGING_GUIDE.md`. Key points:

- `structlog` + `rich` for structured, colourful logs.
- Per‑step markers and duration fields for workflow visibility.
- Log levels controlled by `LOG_LEVEL` and `DEBUG` in `.env`.

Health checks are implemented in `health.py` and exposed via `make health`.

---

## 7. Future Extensions

The architecture is designed for incremental extension:

- **POI/Opening‑hours enrichment**
  - Add a dedicated `POIAgent` that enriches points with Places API data.
  - Integrate as a new step between `PointsSearchAgent` and
    `RouteOptimizationAgent` or as part of a new `ParallelAgent`.

- **User preference memory**
  - Persist preferred works or locations across sessions.
  - Feed this into `PointsFilteringAgent` to pre‑rank points.

- **Alternative routing strategies**
  - Swap out the greedy nearest‑neighbour algorithm for more advanced TSP
    heuristics if needed, using the same `Route` schema.

- **Deployment topologies**
  - Run as a standalone ADK Web app.
  - Expose via HTTP/gRPC for integration into other products.

The current design keeps these options open without complicating the core
pilgrimage workflow. 
