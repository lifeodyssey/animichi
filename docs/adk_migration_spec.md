# Seichijunrei ADK Migration Spec

## 1. Overview

This document defines the unified state schema and agent/event contracts for the
Seichijunrei Bot after migrating from the legacy `AbstractBaseAgent` system to
ADK-native agents (`LlmAgent`, `BaseAgent`, `SequentialAgent`, `ParallelAgent`).

The goals:
- Provide a **single, well-typed session state** shared via
  `InvocationContext.session.state`.
- Make each agent's **inputs and outputs explicit and deterministic**.
- Standardize **Event** shape so that logging, debugging and escalation are
  consistent across the workflow.

The spec is intentionally slightly more general than the initial workflow so
that later features (filtering, POI enrichment) can plug into the same model.

---

## 2. Session State Schema

All agents read/write from `ctx.session.state`, which is a JSON-serializable
`dict[str, Any]`. Keys are namespaced by functional area where appropriate.

### 2.1 Core Fields (always safe to assume exist after root setup)

- `user_query: str | None`
  - Raw user utterance from the chat surface.
  - Set once by the root LlmAgent before calling the workflow.

- `locale: str | None`
  - BCP-47 style locale hint (e.g., `"zh-CN"`, `"ja-JP"`).
  - Optional; used for phrasing / ranking but not required by the workflow.

- `session_id: str`
  - Opaque identifier for the ADK session; mirrors legacy `PilgrimageSession.session_id`.

### 2.2 Extraction Layer

Populated by `ExtractionAgent`.

- `bangumi_name: str | None`
  - Canonicalized anime title extracted from `user_query`.
  - Example: `"Your Name"` or `"Kimi no Na wa."`.

- `location: str | None`
  - Human-readable location or station name extracted from `user_query`.
  - Example: `"Shinjuku"`, `"Akihabara Station"`.

- `extraction_meta: dict`
  - Optional diagnostic information, e.g.:
    - `{"method": "llm", "confidence": 0.87}`.

### 2.3 Bangumi Resolution / Search

Populated primarily by `BangumiSearchAgent`.

- `bangumi_candidates: list[dict]`
  - Raw search results from `search_bangumi_subjects`.
  - Each item is a thin wrapper around Bangumi API subject fields.

- `bangumi_id: int | None`
  - Selected Bangumi subject ID.

- `bangumi_title: str | None`
  - Japanese title of the selected subject.

- `bangumi_title_cn: str | None`
  - Chinese title if available.

- `bangumi_confidence: float | None`
  - 0–1 confidence for the chosen subject.

### 2.4 Location / Coordinates

Populated primarily by `LocationSearchAgent`.

- `station: dict | None`
  - Structured station information derived from
    `search_anitabi_bangumi_near_station`:
    - `{"name": str, "coordinates": {"latitude": float, "longitude": float}, "city": str | None, "prefecture": str | None}`
  - Closely mirrors `domain.entities.Station`.

- `user_coordinates: dict | None`
  - Coordinate object used as origin for searches and routing.
  - Shape: `{ "latitude": float, "longitude": float }`.

- `search_radius_km: float | None`
  - Effective radius used when fetching bangumi/points (for logging, debugging).

### 2.5 Points Search & Enrichment

Initially populated by `PointsSearchAgent`, optionally refined by
filtering/POI agents in later stages.

- `points: list[dict]`
  - Core pilgrimage points near the origin, derived from Anitabi.
  - Each element should be convertible to `domain.entities.Point`:
    - `{
         "id": str,
         "name": str,
         "cn_name": str,
         "coordinates": {"latitude": float, "longitude": float},
         "bangumi_id": str,
         "bangumi_title": str,
         "episode": int,
         "time_seconds": int,
         "screenshot_url": str,
         "address": str | None,
         "opening_hours": str | None,
         "admission_fee": str | None,
         ... extra Anitabi fields OK ...
       }`

- `points_filtered: list[dict] | None`
  - Optional subset after applying user preferences via a future `FilterAgent`.

- `points_enriched: list[dict] | None`
  - Optional enriched list after `POIAgent` adds Google Places details.

- `points_meta: dict`
  - Additional metadata, e.g. `{ "total": int, "source": "anitabi", "max_radius_km": float }`.

### 2.6 Weather

Populated by new ADK `WeatherAgent` (BaseAgent) that wraps `clients.weather`.

- `weather: dict | None`
  - Normalized weather summary used for presentation:
    - `{
         "date": str,
         "location": str,
         "condition": str,
         "temperature_high": int,
         "temperature_low": int,
         "precipitation_chance": int,
         "wind_speed_kmh": int,
         "recommendation": str,
       }`
  - Shape mirrors `domain.entities.Weather` to keep compatibility.

- `weather_raw: dict | None`
  - Optional raw payload from `WeatherClient` for debugging.

### 2.7 Route & Transport

Populated first by `RouteOptimizationAgent`, then refined by `TransportAgent`.

- `route: dict | None`
  - Serialized `domain.entities.Route`:
    - `{
         "origin": { ...Station-like dict... },
         "segments": [
           {
             "order": int,
             "point": { ...Point dict... },
             "transport": {
               "mode": str,
               "distance_meters": int,
               "duration_minutes": int,
               "instructions": str | None,
               "transit_details": dict | None,
             } | None,
             "cumulative_distance_km": float,
             "cumulative_duration_minutes": int,
           },
           ...
         ],
         "total_distance_km": float,
         "total_duration_minutes": int,
         "google_maps_url": str | None,
         "created_at": str,
       }`

- `route_meta: dict`
  - Helper metrics, e.g. `{ "optimized": bool, "waypoints_count": int }`.

### 2.8 Final Plan & Legacy Session

Populated by `TransportAgent` (and potentially a thin finalizer).

- `final_plan: dict | None`
  - LLM-friendly projection of the completed plan, used by the root
    LlmAgent to answer the user.
  - Suggested structure:
    - `{
         "summary": {
           "bangumi_title": str,
           "starting_station": str,
           "points_count": int,
           "total_distance_km": float,
           "total_duration_minutes": int,
         },
         "weather": weather | None,
         "route": route,
         "highlights": [
           {
             "name": str,
             "episode": int,
             "time_seconds": int,
             "address": str | None,
             "notes": str | None,
           },
           ...
         ],
       }`

- `pilgrimage_session: dict | None`
  - Optional full dump compatible with `domain.entities.PilgrimageSession` for
    reuse by existing tools (`MapGeneratorTool`, `PDFGeneratorTool`).
  - This acts as a bridge for Stage 5 where the new workflow still wants to
    call the legacy tools.

---

## 3. Agent Contracts (Read/Write Matrix)

This table shows which keys each planned ADK agent **reads** and **writes**.
It is the source of truth for later implementation stages.

### 3.1 ExtractionAgent (LlmAgent)

- Reads:
  - `user_query`
- Writes:
  - `bangumi_name`
  - `location`
  - `extraction_meta`

### 3.2 BangumiSearchAgent (LlmAgent)

- Reads:
  - `bangumi_name`
- Tools:
  - `search_bangumi_subjects(keyword)`
- Writes:
  - `bangumi_candidates`
  - `bangumi_id`
  - `bangumi_title`
  - `bangumi_title_cn`
  - `bangumi_confidence`

### 3.3 LocationSearchAgent (LlmAgent)

- Reads:
  - `location`
- Tools:
  - `search_anitabi_bangumi_near_station(station_name, radius_km)`
- Writes:
  - `station`
  - `user_coordinates` (from station coordinates)
  - `search_radius_km`

### 3.4 PointsSearchAgent (BaseAgent)

- Reads:
  - `bangumi_id`
  - `user_coordinates`
- Calls:
  - `AnitabiClient.get_bangumi_points`
- Writes:
  - `points`
  - `points_meta`

### 3.5 WeatherAgent (BaseAgent)

- Reads:
  - `user_coordinates`
- Calls:
  - `WeatherClient.get_current_weather` (or forecast)
- Writes:
  - `weather`
  - `weather_raw`

### 3.6 RouteOptimizationAgent (BaseAgent)

- Reads:
  - `user_coordinates` (for origin station placeholder)
  - `points` (or `points_filtered` if present)
  - `station` (when building origin)
- Calls:
  - `GoogleMapsClient.get_multi_waypoint_route`
- Writes:
  - `route`
  - `route_meta`

### 3.7 TransportAgent (BaseAgent)

- Reads:
  - `route`
- Calls:
  - `GoogleMapsClient` for per-segment mode comparison
- Writes:
  - `route` (updated with transport info)
  - `final_plan`
  - `pilgrimage_session` (optional, for compatibility)

---

## 4. Event Format and Semantics

All ADK agents in this workflow must emit `Event` objects from
`google.adk.events` with consistent semantics.

### 4.1 Required Fields

Each yielded event MUST have:

- `author: str`
  - Exactly the agent's `name` (e.g., `"ExtractionAgent"`).

- `content: dict`
  - A *partial* state update. Keys here will be merged into
    `ctx.session.state` using `state.update(content)`.
  - Example from `ExtractionAgent`:
    - `{"bangumi_name": "Your Name", "location": "Shinjuku"}`

- `actions: EventActions`
  - At minimum, `EventActions(escalate: bool)` is used.
  - `escalate=True` indicates this event should be surfaced to the user or
    higher-level orchestrator immediately (e.g., final summary).

### 4.2 Update Rules

- Agents **SHOULD NOT** mutate `ctx.session.state` directly except by writing
  keys they own; the canonical update happens via emitted events.
- Recommended pattern inside `_run_async_impl`:

  ```python
  ctx.session.state.update(partial_state)

  yield Event(
      author=self.name,
      content=partial_state,
      actions=EventActions(escalate=escalate),
  )
  ```

- Agents SHOULD keep their `content` minimal – only keys that actually changed
  in this step.

### 4.3 Escalation Guidelines

- `escalate=True` for:
  - Final results (`TransportAgent` emitting `final_plan`).
  - Important intermediate milestones where the root LlmAgent might want to
    summarize progress or ask the user to disambiguate (e.g., multiple
    `bangumi_candidates`).

- `escalate=False` for:
  - Internal, low-level updates that are not directly user-facing (e.g.,
    weather fetched successfully in the background).

---

## 5. Example State Evolution

Example user query:

> "I am at Shinjuku and want to visit Your Name locations."

1. **Root LlmAgent** initializes:
   - `user_query = "I am at Shinjuku and want to visit Your Name locations."`
   - `session_id = "..."`

2. **ExtractionAgent**:
   - Reads `user_query`.
   - Writes `bangumi_name = "Your Name"`, `location = "Shinjuku"`.

3. **Parallel Search** (`BangumiSearchAgent` + `LocationSearchAgent`):
   - Bangumi side writes `bangumi_id`, titles, confidence.
   - Location side writes `station`, `user_coordinates`, `search_radius_km`.

4. **PointsSearchAgent**:
   - Uses `bangumi_id` + `user_coordinates` to fetch points.
   - Writes `points` and `points_meta`.

5. **Parallel Enrichment**:
   - `WeatherAgent` writes `weather`.
   - `RouteOptimizationAgent` writes `route` and `route_meta`.

6. **TransportAgent**:
   - Reads `route` and optionally `weather`, `points`.
   - Writes updated `route`, `final_plan`, and (optionally) `pilgrimage_session`.

At the end of the Sequential workflow, `ctx.session.state` contains enough
information for the root LlmAgent to generate a rich, user-facing answer and
for downstream tools (map/PDF) to work without needing the legacy orchestrator.
