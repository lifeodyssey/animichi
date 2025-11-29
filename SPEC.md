# Seichijunrei Bot – Technical Specification

## 1. Project Overview

- **Project name**: Seichijunrei Bot
- **Track**: Concierge Agents (travel assistant)
- **Target users**: Anime fans and anime–pilgrimage travellers
- **Context**: Google ADK Capstone project

The goal is to build an agent that helps users plan anime pilgrimage trips:
starting from a metro station, the system finds nearby anime locations,
optimises a route, suggests transport, and produces shareable outputs (map +
PDF guide).

---

## 2. Problem Statement

Anime pilgrimage (visiting real‑world locations that appear in anime) is
increasingly popular, but today travellers face several challenges:

1. **Scattered information** – locations and maps are spread across fan sites
   and communities, with no unified interface.
2. **Route planning complexity** – manually ordering dozens of locations
   without back‑tracking is tedious.
3. **Transport uncertainty** – it is hard to know when to walk, take the
   subway or use buses for each segment.
4. **Poor timeliness** – weather and opening‑hours information is not
   integrated into route planning.

---

## 3. Solution Overview

Seichijunrei Bot is a deterministic multi‑agent workflow built on Google ADK.
Given a natural‑language query such as:

> “I’m at Shinjuku Station and want to visit Your Name locations.”

the system:

1. Extracts the anime title and starting station from the text.
2. Resolves the station to coordinates.
3. Fetches nearby anime pilgrimage points from Anitabi.
4. Filters and ranks the points.
5. Optimises a route that minimises back‑tracking.
6. Calls Google Maps to enrich the route with transport details.
7. Optionally fetches weather information.
8. Generates an interactive HTML map and a PDF pilgrimage guide.

The workflow is implemented as a `SequentialAgent` with embedded
`ParallelAgent` stages for efficiency and clarity.

---

## 4. Functional Requirements

### 4.1 Core features (MVP)

#### F1. Location search

- **Input**: station name (for example `"Shinjuku Station"`, `"Akihabara"`).
- **Processing**:
  - Geocode the station name to GPS coordinates.
  - Query Anitabi for anime works near those coordinates within a given radius
    (default 5 km).
  - Aggregate and sort works by distance and number of points.
- **Output**: list of nearby works, including:
  - work ID and title (original and localized titles where available)
  - cover image URL
  - number of pilgrimage points
  - distance from the origin station.

#### F2. User preference filtering

- **Input**: list of works returned by F1 and the user’s selection of shows
  they have watched.
- **Processing**:
  - Present works to the user (via chat or UI).
  - Keep only points from selected works.
- **Output**: filtered list of pilgrimage points that match user preferences.

#### F3. Route planning

- **Algorithm**: greedy nearest‑neighbour.
  - Start from the station.
  - Repeatedly visit the nearest unvisited point.
  - Continue until all selected points are visited.
- **Output**: ordered route that includes, for each point:
  - sequence number (1st stop, 2nd stop, …)
  - point name
  - associated work
  - episode and timestamp of the scene
  - GPS coordinates
  - minimal metadata for rendering on maps/PDF.

### 4.2 Extended features

#### F4. Transport suggestions

- **Data source**: Google Maps Directions API.
- **Processing**:
  - For each consecutive pair of points, query Directions API.
  - Evaluate walking, transit and other modes as appropriate.
  - Prefer shortest realistic travel time or best combined cost.
- **Output**: for each leg:
  - transport mode (walk, subway, bus, etc.)
  - estimated duration and distance
  - optional step‑by‑step instructions
  - optional transit metadata (line, stops, fare).

#### F5. Weather

- **Data source**: OpenWeatherMap (or equivalent).
- **Processing**:
  - Fetch current or forecast weather for the pilgrimage area.
  - Normalise into a small summary object for display.
- **Output**:
  - condition (e.g. “clear”, “rain”)
  - temperature range
  - precipitation chance
  - simple recommendation (for example “bring a light jacket”).

#### F6. Opening‑hours / POI enrichment (optional)

- **Data sources**: Google Places API or web search.
- **Processing**:
  - For points that map to venues (parks, shrines, cafes, etc.), query for
    opening hours and admission fees.
  - Use this data to adjust recommended visiting order where possible.
- **Output**: per‑point POI details such as:
  - opening hours
  - closed days
  - admission fee
  - additional notes.

#### F7. Map visualisation

- **Output**: interactive HTML map generated with Folium.
- **Content**:
  - origin station marker
  - numbered markers for each pilgrimage point
  - colour coding by work
  - polyline representing the route
  - popups with work name, episode, time and screenshot.

#### F8. PDF guide generation

- **Output**: printable PDF document built from Jinja2 + Playwright.
- **Content**:
  - cover page (station, date, list of works)
  - route overview with map thumbnail
  - detailed itinerary (per stop):
    - order and names
    - work and episode information
    - screenshot (if available)
    - GPS and transport details
  - optional weather summary and notes.

---

## 5. Multi‑Agent Architecture

### 5.1 Agent roles

At the ADK level, the workflow is decomposed as follows:

1. **ExtractionAgent (LlmAgent)**
   - Input: user query string.
   - Output: `bangumi_name`, `location` fields in session state.

2. **BangumiSearchAgent (LlmAgent)**
   - Input: `bangumi_name` from state.
   - Tool: `search_bangumi_subjects`.
   - Output: chosen `bangumi_id`, titles, confidence score.

3. **LocationSearchAgent (LlmAgent)**
   - Input: `location` from state.
   - Tool: `search_anitabi_bangumi_near_station`.
   - Output: `station` struct and `user_coordinates`.

4. **PointsSearchAgent (BaseAgent)**
   - Input: `bangumi_id`, `user_coordinates`.
   - Client: `AnitabiClient`.
   - Output: list of raw pilgrimage points.

5. **PointsFilteringAgent (BaseAgent)**
   - Input: list of points plus user preferences.
   - Output: filtered and possibly ranked list of points.

6. **RouteOptimizationAgent (BaseAgent)**
   - Input: filtered points list.
   - Output: `route` object with ordered segments and cumulative stats.

7. **TransportAgent (BaseAgent)**
   - Input: `route`, `user_coordinates`, `station`.
   - Client: `GoogleMapsClient`.
   - Output: enriched `route` with transport information and `final_plan`.

8. **WeatherAgent (BaseAgent, optional)**
   - Input: `user_coordinates` or station city.
   - Client: `WeatherClient`.
   - Output: `weather` struct.

The orchestrator is a `SequentialAgent` named `seichijunrei_bot` that wires
these agents into a deterministic flow, with `ParallelAgent` groupings for:

- **ParallelSearch** – `BangumiSearchAgent` + `LocationSearchAgent`
- **ParallelEnrichment** – `WeatherAgent` + `RouteOptimizationAgent`

### 5.2 Session state

All agents read and write a shared state dictionary
(`ctx.session.state`), which includes fields such as:

- `user_query: str`
- `bangumi_name: str | None`
- `location: str | None`
- `bangumi_id: int | None`
- `station: dict | None`
- `user_coordinates: { latitude: float, longitude: float }`
- `points: list[dict]`
- `route: dict | None`
- `weather: dict | None`
- `final_plan: dict | None`

The detailed schema and type expectations are defined in
`docs/adk_migration_spec.md` and `adk_agents/seichijunrei_bot/_schemas.py`.

---

## 6. Data Sources

- **Anitabi**
  - Anime pilgrimage database with work metadata and location points.
  - Used for work discovery and point retrieval.

- **Bangumi API**
  - Anime/manga metadata and search.
  - Used to normalise titles and resolve Bangumi IDs.

- **Google Maps Platform**
  - Geocoding API – station name → coordinates.
  - Directions API – routing and travel time / mode suggestions.

- **Weather API (OpenWeatherMap or similar)**
  - Current and forecast weather for the pilgrimage area.

---

## 7. Non‑Functional Requirements

- **Deterministic behaviour**
  - Workflow order and tool calls are fixed by design.
  - LLM agents use typed output schemas to minimise ambiguity.

- **Observability**
  - Structured logging via `structlog`.
  - Per‑step timing and rich context (session ID, bangumi ID, etc.).
  - Optional integration with external monitoring.

- **Testability**
  - Unit tests for domain entities, clients and tools.
  - Separate integration tests for real API calls.

- **Extensibility**
  - Additional agents (for example, POI enrichment) can plug into the same
    session state without breaking the core workflow.

---

## 8. Capstone Evaluation Mapping (Informal)

- **Multi‑agent system**
  - Multiple LlmAgents and BaseAgents composed via Sequential/Parallel agents.

- **Tools**
  - Custom tools for Bangumi and Anitabi.
  - HTTP clients and map/PDF generators.

- **Sessions & memory**
  - Shared, structured session state across the workflow.

- **Observability**
  - Rich logging, timing and simple health checks.

- **Deployment**
  - Designed to be deployed as an ADK Web app and via ADK CLI.

This specification should provide enough detail for contributors and reviewers
to understand the intended behaviour, interfaces and architecture of
Seichijunrei Bot. 
