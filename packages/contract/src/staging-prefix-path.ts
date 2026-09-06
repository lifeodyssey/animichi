/**
 * Where a frozen trajectory prefix is seeded (E-1 #1380, spec
 * `docs/specs/2026-09-01-agent-ts-rewrite-spec.md` §十 10.1, 李博杰《深入理解 AI
 * Agent》第 7 章「评估环境」`initialization_actions`).
 *
 * The path and nothing else, in an import-free module, for the reason
 * `agent-paths.ts` gives: `workers/edge` reads this value at RUNTIME, and a
 * value import from a zod module pulls all 79 of zod's files into the Worker
 * bundle (#1285, `test/import-free-modules.test.ts` is the gate). The request
 * SHAPE lives beside it in `staging-prefix-contract.ts`, which the Node-side
 * eval harness loads and the Worker does not.
 *
 * IT IS DELIBERATELY NOT IN `AGENT_PATHS`. That inventory is the PUBLISHED
 * Agent surface — the routing and rate tables derive their allowlists from it
 * and the OpenAPI emitters document every entry — and this procedure exists on
 * exactly one deployment. Publishing it would document a route production must
 * not have and would let a production routing table name it; the mount is
 * `APP_ENV === "staging"` in `workers/edge/src/gateway/staging-prefix-route.ts`
 * and nowhere else. Nothing is emitted, so `vet:openapi` and the drift gates
 * see an additive module and no document change.
 */

/** The parameter template, in the same `{param}` spelling `AGENT_PATHS` uses. */
export const STAGING_PREFIX_PATH_TEMPLATE = "/v1/staging/sessions/{session_id}/prefix";

/** The prefix every such request's pathname starts with. */
export const STAGING_PREFIX_PATH_ROOT = "/v1/staging/sessions/";

/** The tail the pathname ends with, after the session id. */
export const STAGING_PREFIX_PATH_TAIL = "/prefix";

/** The `APP_ENV` value that mounts the procedure. Fail closed: this literal
 * and nothing else — not a truthy value, not a case-folded one. */
export const STAGING_APP_ENV = "staging";

/**
 * The most a seeding body may weigh, in BYTES of UTF-8.
 *
 * A prefix carries a whole tool return, so `MESSAGE_MAX_CHARS` (4 000, the
 * chat turn's ceiling) is the wrong bound — a real `resolve_anime` answer is
 * larger than a chat message and the seeded one has to be able to match it.
 * What DOES bound it is the other half of a prefix: the session envelope goes
 * into Durable Object storage, whose per-value limit is 128 KiB, and a body
 * that could not fit its own candidate list there is a body the write would
 * fail on anyway. Half of that limit leaves room for the memory ledgers the
 * envelope also carries, and is still ~300x the largest of today's five cases.
 *
 * Bytes rather than characters because that is what both limits count; a
 * character bound would let one CJK title weigh three times what it measured.
 */
export const PREFIX_MAX_BYTES = 64 * 1024;

/** The path one session's prefix is seeded at, as a caller spells it. */
export function stagingPrefixPathFor(sessionId: string): string {
  return `${STAGING_PREFIX_PATH_ROOT}${encodeURIComponent(sessionId)}${STAGING_PREFIX_PATH_TAIL}`;
}
