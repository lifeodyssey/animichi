// W0-S1 spike (#1244), extended by W0-S2 (#1245), W0-S4 (#1247) and W0-S5
// (#1248): the probe Worker's whole public surface, as a pure function. An
// unmatched path is a 404, the same contract the production edge keeps.
//
// S1 owns `/turn` and `/turn/abort` (one pi turn, and the three abort break
// points). S2 adds `POST /compat` (one measured turn under one gateway-dialect
// switch set). S4 adds `/turn/long` (the deliberately-long alarm-hosted turn)
// and `GET /runs/:id` (what the client reads after it disconnected — the
// spike's stand-in for `GET /v1/conversations/:id/messages`, spec §三). S5 adds
// `POST /egress` (one row of the BYOK red-line matrix) and
// `GET /egress/platform` (what the platform's own outbound proxy refuses) and
// `GET /egress/redirect` (the redirect re-validation, against a fixed fixture).
//
// Three tiers serve these: the Worker's own fetch answers `/healthz`,
// `/compat` and the three S5 egress routes; `PiTurnSession` takes S1's two turn
// routes (`isSessionRoute`); `DurableTurnSession` takes S4's two. `/compat`
// stays out of a Durable Object on purpose — S1 puts turns in the alarm to
// prove a turn survives the caller hanging up, which is not S2's question; S2
// measures the round trip the caller is waiting on, so the measurement and the
// response belong to the same request.

export type SpikeRoute =
  | "healthz"
  | "turn"
  | "turn_abort"
  | "turn_long"
  | "run_status"
  | "compat"
  | "egress"
  | "egress_platform"
  | "egress_redirect"
  | "not_found";

/** `GET /runs/<uuid>`; the id shape is pinned so no other GET path can match. */
const RUN_STATUS_PATH = /^\/runs\/([0-9a-fA-F-]{36})$/;

export function runIdOf(pathname: string): string | null {
  return RUN_STATUS_PATH.exec(pathname)?.[1] ?? null;
}

const GET_ROUTES: Readonly<Record<string, SpikeRoute>> = {
  "/healthz": "healthz",
  "/egress/platform": "egress_platform",
  "/egress/redirect": "egress_redirect",
};

const POST_ROUTES: Readonly<Record<string, SpikeRoute>> = {
  "/compat": "compat",
  "/egress": "egress",
  "/turn": "turn",
  "/turn/abort": "turn_abort",
  "/turn/long": "turn_long",
};

function getRouteOf(pathname: string): SpikeRoute {
  const fixed = GET_ROUTES[pathname];
  if (fixed !== undefined) return fixed;
  return runIdOf(pathname) === null ? "not_found" : "run_status";
}

export function routeOf(method: string, pathname: string): SpikeRoute {
  if (method === "GET") return getRouteOf(pathname);
  if (method !== "POST") return "not_found";
  return POST_ROUTES[pathname] ?? "not_found";
}

export function abortRequiredFor(route: SpikeRoute): boolean {
  return route === "turn_abort";
}

/** Which routes S1's `PiTurnSession` serves; see the tier note above. */
export function isSessionRoute(route: SpikeRoute): boolean {
  return route === "turn" || route === "turn_abort";
}
