# Users

Owns authenticated-user documents and claims of anonymous work after login. Does not own Point geometry or Itinerary algorithms — only references (e.g. point ids).

Design (Thin CA + greenfield schema):
`docs/specs/2026-08-06-users-clean-architecture-design.md`
**Status:** ACCEPTED core BC (§0.2). Product surfaces still OPEN (§0.3 O1–O12) — do not implement those as if designed.

## Language

**SavedRoute**:
A user document: title, ordered `point_ids`, status (`draft` | `saved` | `completed`), optional planning hints. Table: `saved_routes`. May be unclaimed (`user_id` null + `claim_session_id` set).
_Avoid_: Route, Itinerary, UserRoute, table name `routes`

**SavedRouteStatus**:
`draft` | `saved` | `completed`.

**Claim**:
Assign unclaimed SavedRoutes (`user_id` IS NULL, matching `claim_session_id`) to the authenticated user after login.
_Avoid_: Migrate (reserved for schema/auth platform moves)

**SessionSummary**:
Read-only list projection of an agent Conversation for “history” UI. Not auth session; not ownership of messages.
_Avoid_: Calling this Conversation ownership

**RouteShare** / **ShareToken**:
Public share of a SavedRoute; store token hash; freeze `public_snapshot` at create. Table: `route_shares`.

**WalkCheckin**:
Walk check-in with offline idempotency via `client_id`. Table: `walk_checkins`.

**UserMemory**:
Cross-session profile (SD-15 dormant). Session-scoped memory stays with Agent.

## Ownership (summary)

| Concept | Owner |
| --- | --- |
| SavedRoute, RouteShare, WalkCheckin, UserMemory (when awake) | **Users** |
| Conversation, messages, in-session memory | **Agent** |
| Point / Bangumi / Itinerary computation | **Catalog** |
