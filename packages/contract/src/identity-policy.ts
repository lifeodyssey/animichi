/**
 * The deployed identity matrix (AUTH-1 #945; extracted #1285).
 *
 * Values mirror `workers/edge/wrangler.toml [vars]` so the config surface
 * cannot diverge from the contract (pinned by
 * `workers/edge/test/identity-policy-matrix.test.ts`), and the edge reads this
 * document at RUNTIME — `src/protect/rate-limiter.ts` takes its defaults off it
 * rather than repeating two numbers.
 *
 * It lives here, apart from `identity-contract.ts`, for that runtime read: the
 * document is plain data, its old home imports zod, and a value import from a
 * zod module pulls the whole of zod into the Worker bundle
 * (`workers/edge/bundle-smoke/entry-bundle.test.ts` is the gate). The schemas
 * that give it meaning stay in the contract and still parse it
 * (`test/identity-contract.test.ts`), so there is one declaration and no
 * mirror. **Keep this module free of runtime imports**
 * (`test/import-free-modules.test.ts` enforces it).
 */
import type { IdentityPolicy } from "./identity-contract.js";

/** Deep-freeze so the shared default can never be mutated on a hot isolate. */
function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null) return value;
  for (const child of Object.values(value as object)) deepFreeze(child);
  return Object.freeze(value);
}

export const DEFAULT_IDENTITY_POLICY: IdentityPolicy = deepFreeze({
  public: {
    rateLimit: null,
    dailyMessageQuota: null,
    dailyCostBudgetUsd: null,
  },
  anonymous: {
    rateLimit: { limit: 20, windowSeconds: 60 },
    dailyMessageQuota: 20,
    dailyCostBudgetUsd: 5.0,
  },
  authenticated: {
    rateLimit: { limit: 60, windowSeconds: 60 },
    dailyMessageQuota: null,
    dailyCostBudgetUsd: null,
  },
});
