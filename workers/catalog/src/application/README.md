# application

Application use-case layer (Clean Architecture).

First vertical slice lands here at #838: `plan-itinerary.ts` (the PlanItinerary
use case). Inbound adapters (`src/api/*`) call use cases here; use cases
orchestrate domain kernels without knowing about I/O — data arrives through
ports (e.g. `PointsForRoutePort`), implemented by outbound adapters under
`src/adapters/outbound/`.

A port is declared **here**, next to the use case that needs it — never in the
adapter that implements it. `test/dependency-rule.worker.test.ts` fails on any
import from `adapters/`, `api/`, the data-platform stages, `db/`, hono or
drizzle, in this layer or in `src/domain/`.
