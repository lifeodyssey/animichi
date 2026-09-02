// W0-S1 spike (#1244): the probe Worker's whole public surface, as a pure
// function. Three routes, nothing else — an unmatched path is a 404, the same
// contract the production edge keeps.

export type SpikeRoute = "healthz" | "turn" | "turn_abort" | "not_found";

export function routeOf(method: string, pathname: string): SpikeRoute {
  if (method === "GET" && pathname === "/healthz") return "healthz";
  if (method !== "POST") return "not_found";
  if (pathname === "/turn") return "turn";
  if (pathname === "/turn/abort") return "turn_abort";
  return "not_found";
}

export function abortRequiredFor(route: SpikeRoute): boolean {
  return route === "turn_abort";
}
