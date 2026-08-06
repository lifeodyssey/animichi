# Published language: Point, Bangumi, Itinerary, SavedRoute, Session

Cross-service speech used overloaded English **Route** (computed plan vs user-owned save) and **Work** / **PilgrimagePoint** in ways that fight the monorepo boundaries. We lock the published language below.

**Canonical terms**

- **Point** — one visitable seichi stop (coordinates / media / bangumi link). Not `PilgrimagePoint`.
- **Bangumi** — one anime title in the catalog (typically `bangumi_id`). Not `Work` / `work_id`.
- **Itinerary** — Catalog-computed ordered plan over Points (optional pacing/timing). Not bare `Route`.
- **SavedRoute** — user-owned saved record (`point_ids` + metadata + status). Not bare `Route` / `UserRoute`.
- **Session** — user–agent dialogue context. Not an auth cookie without a qualifier.

**Why**

- Catalog owns Itinerary computation; Users owns SavedRoute persistence; Agent owns Session. One English word must not span three owners.
- Bangumi matches the external id space we already key on; Work is too broad in a multi-service codebase.

**Consequences**

- Glossaries: `CONTEXT-MAP.md` and per-package `CONTEXT.md`.
- New docs, issues, and package-internal domain names use the table above.
- **Greenfield (2026-08-06):** no production users → **wire types, HTTP paths, and DB column/table names move to the table above in the same migration train**. No long-lived dual names. Detail: `docs/superpowers/specs/2026-08-06-greenfield-language-and-data-plane.md`.

**Supersedes**

- Earlier wording that “wire type renames may lag” — lag is **not** the default under greenfield.