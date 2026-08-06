# Catalog

Owns seichi **master data** and **planning algorithms**: Bangumi, Points, search/nearby/geocode, and Itinerary computation. Read-mostly for the Agent; public anonymous reads for some overview/search surfaces. Does **not** own login identity, SavedRoute documents, or Agent Session state.

Published language: ADR-0002 · greenfield: `docs/superpowers/specs/2026-08-06-greenfield-language-and-data-plane.md`.

## Language

**Point**:
A visitable seichi stop Catalog stores and returns (coordinates, screenshot, bangumi link, optional episode/time).
_Avoid_: Spot in contracts, PilgrimagePoint

**Bangumi**:
A cataloged anime title (typically `bangumi_id` digit string on the wire).
_Avoid_: Work, work_id

**Itinerary**:
Catalog's computed ordered plan over selected Points (cluster → order → optional timing/pacing).
_Avoid_: SavedRoute, bare Route

**Cluster** · **Origin** · **Pacing** · **Alias** · **Ingest/Enrich/Publish** · **Gazetteer entry**:
As in prior glossary; pipeline stages are not fan-facing nouns.

## Owns / does not own

| Owns | Does not own |
|---|---|
| Point rows, Bangumi identity | User identity / JWT |
| Itinerary computation | SavedRoute persistence (Users) |
| Search, nearby, geocode, anime overview | Agent Session / messages |
| Ingest→enrich→publish | Edge rate limits |

## Wire / tables (greenfield target)

| Avoid (today) | Target |
|---|---|
| `PilgrimagePoint`, `Route` | `Point`, `Itinerary` |
| `work_id`, `pointsByWorkId` | `bangumi_id`, `pointsByBangumiId` |
| `POST /catalog/route` | `POST /catalog/itinerary` |
| `route_snapshots`, column `work_id` | `itinerary_snapshots`, `bangumi_id` |

## Design

`docs/superpowers/specs/2026-08-06-catalog-clean-architecture-design.md` (ACCEPTED + greenfield).
