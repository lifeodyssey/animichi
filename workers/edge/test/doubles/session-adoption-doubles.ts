// Shared doubles for the native adoption route's two edge suites (#1601):
// `test/session-adopt.test.ts` (route behaviour) and
// `test/session-adopt-boundary.test.ts` (pre-write refusals). The anonymous
// env, the default result and the store fake were copy-pasted into both; this
// is their single home. `stubCtx` / `alwaysAllowGuard` already have one in
// `src/container/entry-env.ts`, which both suites import directly.
import type { SessionAdoptionResult, SessionAdoptionStore } from "../../src/identity/session-adopt.ts";
import { TEST_ANON_SECRET } from "./signed-anonymous-cookie.ts";

/** The adoption route's anonymous env: resolving (never minting) an `aid`
 * needs both ANON_ACCESS_ENABLED and the HMAC secret. */
export const ADOPTION_ANON_ENV = {
  ANON_ACCESS_ENABLED: "true",
  ANON_ID_SECRET: TEST_ANON_SECRET,
  EDGE_SHOWCASE_MODE: "false",
};

export const DEFAULT_ADOPTION_RESULT: SessionAdoptionResult = {
  adopted: 1,
  noop_class: "adopted",
  revisions_bumped: 1,
};

/** A `SessionAdoptionStore` double that counts writes and records each
 * `adopt(fromAnonId, toUserId)` pair. */
export function adoptionStore(
  writes: { count: number },
  result: SessionAdoptionResult = DEFAULT_ADOPTION_RESULT,
  calls: [string, string][] = [],
): SessionAdoptionStore {
  return { adopt: (fromAnonId, toUserId) => recordAdoption(writes, calls, result, fromAnonId, toUserId) };
}

function recordAdoption(
  writes: { count: number },
  calls: [string, string][],
  result: SessionAdoptionResult,
  fromAnonId: string,
  toUserId: string,
): Promise<SessionAdoptionResult> {
  writes.count += 1;
  calls.push([fromAnonId, toUserId]);
  return Promise.resolve(result);
}
