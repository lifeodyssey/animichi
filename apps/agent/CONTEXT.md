# Agent

Orchestrates the pilgrimage dialogue: tool loop, Session state, and calls out to Catalog (and related ports). Does not own Point master data or SavedRoute persistence.

Greenfield language + data plane:
`docs/specs/2026-08-06-greenfield-language-and-data-plane.md`

## Language

**Session**:
The agent-side dialogue and tool state for one ongoing chat (anonymous or authenticated).
_Avoid_: Using “session” alone for auth cookies

**Conversation**:
Persisted dialogue log (messages). Agent write authority; Users may list SessionSummary as read-only projection.

**Point** · **Bangumi** · **Itinerary**:
Same as published language; obtained via Catalog. Not owned as master data here.
_Avoid_: PilgrimagePoint, Work, bare Route

**Fact ledger / hard constraint**:
In-session constraints that survive compaction. Not cross-session UserMemory (Users).

## Owns / does not own

| Owns | Does not own |
|---|---|
| Session runtime, messages, in-session memory | Point/Bangumi master data |
| Anon quota / usage metering hooks | SavedRoute / Share / Check-in |
| Catalog **read** client | Catalog ingest / write |
| | Cross-session `user_memory` (Users when awake) |

## Greenfield code targets

- Types: `Point`, `Itinerary` (drop `Route` / `PilgrimagePoint` mirrors).
- Catalog paths follow contract (`/catalog/itinerary`, `bangumi_id`, …).
- **Delete** direct master-data write ports (no dual-path debt).

## Design

`docs/specs/2026-08-06-agent-clean-architecture-design.md` (ACCEPTED + greenfield).
