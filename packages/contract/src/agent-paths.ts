/**
 * Complete Agent HTTP path inventory (CONTRACT-1 #938; extracted #1285).
 *
 * The edge Worker serves every entry, and no entry has a downstream runtime
 * left to mirror: most are the native agent tier's routes
 * (`workers/edge/src/agent/`, selected by `turnRoutePolicy`), `GET /healthz`
 * is the gateway's own readiness answer (#1596), and the entries marked
 * `runtime: "edge"` carry the flag that used to divide the container's
 * mounts from this Worker's own additions.
 *
 * It is this table, not the flag, that is read at RUNTIME by the edge
 * gateway's routing and rate tables
 * (`workers/edge/src/gateway/routing-policy.ts`, `rate-policy.ts`), which
 * match method + path against these entries and derive their allowlists
 * from it rather than hand-maintaining a second vocabulary — `agentRule`
 * never touches `runtime`. With the container gone (#1605) the flag
 * decides nothing at runtime: the emitter copies it into the emitted
 * `x-runtime` field (`scripts/emit-openapi.ts`), which exempts an
 * operation from the marker-less phantom-surface rule in
 * `workers/edge/test/operation-reachability.test.ts`, and the readers it
 * has left are tests — `workers/edge/test/route-inventory.test.ts` reads
 * `AGENT_PATHS[].runtime` directly, while
 * `test/native-list-boundary.test.ts` and `test/native-stream-boundary.test.ts`
 * pin the emitted field on the list and stream documents.
 *
 * It lives here, apart from `agent-contract.ts`, precisely because of that
 * runtime read: this table is plain data with no schema in it, while its old
 * home imports zod, and a value import from a zod module pulls the whole of
 * zod into the Worker bundle for the inventory's strings (`workers/edge/bundle-smoke/
 * entry-bundle.test.ts` is the gate). Nothing is generated and nothing is
 * mirrored: this is the ONE declaration, and the OpenAPI emitter, the edge and
 * the contract's own drift tests
 * (`test/composition.test.ts` against the committed `agent-openapi.json`) all
 * read it here — `agent-contract.ts` does not re-export it, because a runtime
 * re-export out of the zod module would put zod back in the bundle.
 * **Keep this module import-free** (a type-only import is fine;
 * `test/import-free-modules.test.ts` enforces it).
 *
 * `summary` is the inventory entry only — it is not emitted into generated
 * models (spec rule 7: future paths appear in the inventory, not as unused
 * models).
 */

/** One published Agent path in the complete inventory. */
export interface AgentPath {
  method: "GET" | "POST" | "PATCH";
  path: string;
  summary: string;
  /** Edge-owned additions the container never mounted. */
  runtime?: "edge";
}

export const AGENT_PATHS: AgentPath[] = [
  { method: "GET", path: "/healthz", summary: "gateway readiness" },
  { method: "POST", path: "/v1/chat", summary: "chat turn" },
  { method: "POST", path: "/v1/byok/probe", summary: "probe a bring-your-own-key credential" },
  { method: "GET", path: "/v1/conversations", summary: "list conversations", runtime: "edge" },
  { method: "GET", path: "/v1/conversations/{session_id}/messages", summary: "conversation messages" },
  { method: "GET", path: "/v1/conversations/{session_id}/stream", summary: "resume the native conversation stream", runtime: "edge" },
  { method: "POST", path: "/v1/sessions/adopt", summary: "adopt anonymous sessions", runtime: "edge" },
];
