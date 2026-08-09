# Edge

Request gateway: identity, rate limits, routing to Catalog / Users / Agent container, image and tile proxies. **Does not own** Point, Bangumi, Itinerary, or SavedRoute models — only forwards and enforces access policy.

**Tier:** Gateway — **no pilgrimage domain model**, **no `src/domain/`**.

Structure (implemented): `src/` production (entry/app/env + identity/gateway/protect/proxy/container), `test/` + `test/doubles/` (node:test).
Design doc: `docs/specs/2026-08-06-edge-gateway-structure-design.md`

Greenfield path strings:
`docs/specs/2026-08-06-greenfield-language-and-data-plane.md`

## Domain model?

**No.** Gateway vocabulary only:

| Term | Means |
|---|---|
| **Identity** | Who is calling (anon / JWT sub / API key) — not Agent Session |
| **Forward** | Pass /v1 to Catalog, Users, or Agent container with injected headers |
| **Policy** | Pure path allowlists / rate-limit scope — not business rules |
| **Proxy** | Image / tiles / R2 — not catalog SQL |
| **Container** | Agent runtime lifecycle — not a pilgrimage entity |

## Owns / does not own

| Owns | Does not own |
|---|---|
| Authn at edge, rate limits, turnstile, forwarding | Itinerary planning, SavedRoute CRUD |
| Container env / egress denylist config | HTML pages (apps/web) |
