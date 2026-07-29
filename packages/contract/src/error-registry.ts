import { z } from "zod";

/**
 * Anonymous-access limit codes (issues #274 S1.8, #282 S1.10) and the payload
 * they carry. These are the *rejection* half of the anonymous contract: the
 * edge and the container ingress emit them on a `403` and the web client
 * classifies them into distinct fallback states. They live here because three
 * tiers have to agree on the literal string and the payload shape — a private
 * copy per tier is exactly how a D11/D12 banner degrades into a generic
 * "session expired".
 *
 * The two limits are deliberately separate, not two names for one thing: the
 * budget is a *global dollar* ceiling shared by every anonymous visitor; the
 * quota is *one identity's* daily message allowance. Only the quota can be
 * lifted by that visitor signing in — or by waiting for `quota_resets_at`.
 *
 * `403 + code` (rather than `429`) matches the `anon_budget_exhausted`
 * precedent; `quota_resets_at` carries the information a `Retry-After` would
 * have, so the client can auto-unlock and name the time instead of guessing at
 * "today", which is wrong across every timezone but the server's.
 */

/** Global anonymous daily-dollar breaker (X4); mirror: `worker/costBreaker.ts`. */
export const ANON_BUDGET_EXHAUSTED_CODE = "anon_budget_exhausted";

/** Per-identity daily message quota (S1.10). */
export const ANON_QUOTA_EXHAUSTED_CODE = "anon_quota_exhausted";

/** Every anonymous-limit rejection code, for exhaustive handling. */
export type AnonLimitCode =
  | typeof ANON_BUDGET_EXHAUSTED_CODE
  | typeof ANON_QUOTA_EXHAUSTED_CODE;

/** Payload on an `anon_quota_exhausted` rejection: when the allowance returns. */
export const AnonQuotaExhaustedData = z.object({
  quota_resets_at: z.iso.datetime({ offset: true }),
});
/** Inferred TS type for the anonymous quota rejection payload. */
export type AnonQuotaExhaustedData = z.infer<typeof AnonQuotaExhaustedData>;

/** Users-service error codes are feature-namespaced: ROUTE_*, CHECKIN_*, SHARE_*. */
export type ErrorRegistryItem = {
  readonly status: number;
  readonly category: string;
  readonly message: string;
  readonly data: z.ZodType<unknown>;
};

type ErrorRegistry = Readonly<Record<string, ErrorRegistryItem>>;
type ErrorCode<Registry extends ErrorRegistry> = keyof Registry & string;
type PickedError<Registry extends ErrorRegistry, Code extends ErrorCode<Registry>> = Pick<
  Registry[Code],
  "status" | "message" | "data"
>;
type PickedErrors<Registry extends ErrorRegistry, Code extends ErrorCode<Registry>> = {
  [Key in Code]: PickedError<Registry, Key>;
};

function registryItem<Registry extends ErrorRegistry>(
  registry: Registry,
  code: ErrorCode<Registry>,
): ErrorRegistryItem {
  const item = registry[code];
  if (!item) throw new Error(`Unknown error code: ${code}`);
  return item;
}

/** Pick oRPC error entries while dropping registry-only category metadata. */
export function pickErrors<Registry extends ErrorRegistry, const Code extends ErrorCode<Registry>>(
  registry: Registry,
  codes: readonly Code[],
): PickedErrors<Registry, Code> {
  const entries = codes.map((code) => {
    const { status, message, data } = registryItem(registry, code);
    return [code, { status, message, data }] as const;
  });
  return Object.fromEntries(entries) as PickedErrors<Registry, Code>;
}
