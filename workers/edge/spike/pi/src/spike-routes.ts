// W0-S1 spike (#1244), extended by W0-S4 (#1247): the probe Worker's whole
// public surface, as a pure function. An unmatched path is a 404, the same
// contract the production edge keeps.
//
// S1 owns `/turn` and `/turn/abort` (one pi turn, and the three abort break
// points). S4 adds `/turn/long` (the deliberately-long alarm-hosted turn) and
// `GET /runs/:id` (what the client reads after it disconnected — the spike's
// stand-in for `GET /v1/conversations/:id/messages`, spec §三).

export type SpikeRoute =
  | "healthz"
  | "turn"
  | "turn_abort"
  | "turn_long"
  | "run_status"
  | "not_found";

/** `GET /runs/<uuid>`; the id shape is pinned so no other GET path can match. */
const RUN_STATUS_PATH = /^\/runs\/([0-9a-fA-F-]{36})$/;

export function runIdOf(pathname: string): string | null {
  return RUN_STATUS_PATH.exec(pathname)?.[1] ?? null;
}

export function routeOf(method: string, pathname: string): SpikeRoute {
  if (method === "GET" && pathname === "/healthz") return "healthz";
  if (method === "GET") return runIdOf(pathname) === null ? "not_found" : "run_status";
  if (method !== "POST") return "not_found";
  if (pathname === "/turn") return "turn";
  if (pathname === "/turn/abort") return "turn_abort";
  if (pathname === "/turn/long") return "turn_long";
  return "not_found";
}

export function abortRequiredFor(route: SpikeRoute): boolean {
  return route === "turn_abort";
}
