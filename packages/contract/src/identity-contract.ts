import { z } from "zod";

/**
 * The explicit identity matrix (AUTH-1 #945): the identity classes the edge
 * gateway recognizes, and the numeric configuration governing each class.
 * This is the single typed document for those cells. The deployed values
 * themselves are `DEFAULT_IDENTITY_POLICY` in `./identity-policy.ts` — one
 * declaration, parsed by the schemas here (`test/identity-contract.test.ts`)
 * and read by the edge (workers/edge/src/identity/auth.ts and
 * protect/rate-limiter.ts), so a value can never drift between the contract,
 * the deployed config, and the enforcement code. It lives in its own
 * import-free module because this one imports zod and the edge is bundled
 * (#1285).
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
