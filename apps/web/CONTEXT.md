# Web (UI)

Browser surface only (TanStack Start). **Does not own** pilgrimage master data or SavedRoute authority.

## Domain model?

**No.** There is **no** `src/domain/` and no DDD aggregate layer for Point / Bangumi / Itinerary / SavedRoute.

- **Contract DTOs** (`@animichi/contract`) are the published wire language at the API boundary.
- **Features** hold UI state and composition only.
- Rules and persistence live in Catalog / Users / Agent.

## Language (wire / UI)

Use published terms in code identifiers: **Point**, **Bangumi**, **Itinerary**, **SavedRoute**, **Session** (chat). Product copy may stay localized.

## Layout target

See `docs/superpowers/specs/2026-08-06-web-ui-structure-design.md`.

```text
routes → features → api/hooks → api clients → public /v1
platform/ = cross-feature auth, byok, turnstile, styles
```

## Owns / does not own

| Owns | Does not own |
|---|---|
| Pages, features, SSR shell | Catalog ingest / itinerary algorithms |
| Client transport + MSW against contract | Users persistence authority |
| Neon Auth **client** (login UI) | JWT verification for users worker |
