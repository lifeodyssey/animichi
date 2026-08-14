import type { SaveSavedRouteInput } from "@animichi/contract";

/** The operation namespace every SavedRoute-create idempotency key belongs to. */
export const SAVED_ROUTE_OP = "saveSavedRoute" as const;

/** Idempotency liveness window for an in_flight claim (AC4 timeout-after-commit). */
export const IDEMPOTENCY_EXECUTION_TIMEOUT_MS = 10_000;

/** Retention window a committed key is honored for before it is reclaimable. */
export const IDEMPOTENCY_RETENTION_MS = 24 * 60 * 60 * 1000;

/** Canonical, order-stable fingerprint of a create payload. Two payloads are
 * "the same request" when they serialize to the same fingerprint; point order
 * is significant, so point_ids are not sorted. */
export function canonicalFingerprint(input: SaveSavedRouteInput): string {
  const pointIds = JSON.stringify(input.point_ids);
  const status = JSON.stringify(input.status);
  const title = JSON.stringify(input.title);
  return ["point_ids", pointIds, "status", status, "title", title].join(":");
}

/** Lifetime end for a fresh idempotency row created at now. */
export function retentionExpiry(now: number, retentionMs = IDEMPOTENCY_RETENTION_MS): string {
  return new Date(now + retentionMs).toISOString();
}

/** True when the row's retention window has elapsed at now (AC4). */
export function isExpired(expiresAtIso: string, now: number): boolean {
  return Date.parse(expiresAtIso) <= now;
}

/** True when an in_progress claim is still within its liveness window. */
export function isInFlight(createdAtIso: string | null, now: number, timeoutMs = IDEMPOTENCY_EXECUTION_TIMEOUT_MS): boolean {
  if (createdAtIso === null) return false;
  const created = Date.parse(createdAtIso);
  return Number.isFinite(created) && created > now - timeoutMs;
}
