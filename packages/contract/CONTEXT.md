# Shared contract (published language)

Types and error codes exchanged across deployable units. Not a full bounded context — a **published language** so Agent, Catalog, Users, Edge, and Web do not invent parallel words for the same wire shapes.

Greenfield rename train:
`docs/specs/2026-08-06-greenfield-language-and-data-plane.md`

## Language

**Point**:
A single visitable place tied to anime media. Atomic seichi stop on the wire.
_Avoid_: PilgrimagePoint, Spot, Location

**Bangumi**:
One anime title / work as identified in our catalog (`bangumi_id`).
_Avoid_: Work, work_id field name

**Itinerary**:
A computed, ordered plan over Points. Produced by Catalog; not a long-lived user document.
_Avoid_: Route (ambiguous), Plan (product sense)

**SavedRoute**:
User-owned record: title, ordered point ids, status. May recompute Itinerary when opened.
_Avoid_: UserRoute, bare Route

**Session**:
User–agent dialogue context. Distinct from auth tokens.
_Avoid_: Conversation as the cross-service noun (Agent may still say Conversation for message log)

**Origin** · **Pacing**:
Planning start and packing preference (chill | normal | packed).

## Greenfield wire targets

| Old | New |
|---|---|
| `PilgrimagePoint` | `Point` |
| `Route` (plan result) | `Itinerary` |
| `work_id` | `bangumi_id` |
| `/catalog/route` | `/catalog/itinerary` |
| `UserRoute`, `/v1/users/routes` | `SavedRoute`, `/v1/users/saved-routes` |
| share/checkin `route_id` | `saved_route_id` |

No long-lived dual exports.
