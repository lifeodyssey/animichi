import { z } from "zod";

/**
 * The explicit identity matrix (AUTH-1 #945): the identity classes the edge
 * gateway recognizes, and the numeric configuration governing each class.
 * This is the single typed document for those cells; the edge worker consumes
 * `DEFAULT_IDENTITY_POLICY` (see workers/edge/src/identity/auth.ts and
 * protect/rate-limiter.ts) so a value can never drift between the contract,
 * the deployed config, and the enforcement code.
 *
 * The path -> class classification lives in the edge's
 * `workers/edge/src/gateway/routing-policy.ts` (PUBLIC_V1 / ANON_V1); this
 * contract owns the classes and their numbers only.
 */

export const IDENTITY_CLASSES = ["public", "anonymous", "authenticated"] as const;

export const identityClassSchema = z.enum(IDENTITY_CLASSES);
export type IdentityClass = z.infer<typeof identityClassSchema>;

/** A per-identity fixed-window burst limit. */
export const identityRateLimitSchema = z.object({
  limit: z.number().int().positive(),
  windowSeconds: z.number().int().positive(),
});
export type IdentityRateLimit = z.infer<typeof identityRateLimitSchema>;

/** The numeric cells one identity class is governed by. A `null` cell means
 * "this control does not apply to this class". */
export const identityClassPolicySchema = z.object({
  rateLimit: identityRateLimitSchema.nullable(),
  /** Per-identity daily message quota; `0` disables it (container-enforced). */
  dailyMessageQuota: z.number().int().nonnegative().nullable(),
  /** Global daily cost ceiling in USD; `0` disables it (container-enforced). */
  dailyCostBudgetUsd: z.number().nonnegative().nullable(),
});
export type IdentityClassPolicy = z.infer<typeof identityClassPolicySchema>;

export const identityPolicySchema = z.object({
  public: identityClassPolicySchema,
  anonymous: identityClassPolicySchema,
  authenticated: identityClassPolicySchema,
}).strict();
export type IdentityPolicy = z.infer<typeof identityPolicySchema>;

/** The deployed matrix. Values mirror workers/edge/wrangler.toml [vars] so the
 * config surface cannot diverge from the contract (pinned by
 * workers/edge/test/identity-policy-matrix.test.ts). */
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

/** Deep-freeze so the shared default can never be mutated on a hot isolate. */
function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null) return value;
  for (const child of Object.values(value as object)) deepFreeze(child);
  return Object.freeze(value);
}
