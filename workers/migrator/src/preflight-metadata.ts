import { validPrismaRef } from "./prisma-target";

export const MAX_PREFLIGHT_BYTES = 65_536;

/**
 * The migration request body: one schema identity, and nothing else (#1634, #1635). The Atlas
 * chain head, its checksum file and the per-file entry list left with the apply engine that read
 * them; the staging-only baseline flag left with the guard the owner deleted rather than rehoused
 * (#1621). The key set is compared EXACTLY, so an extra or missing key is an invalid request
 * rather than a silently ignored field — which is why sender and receiver can only change
 * together.
 */
export interface PreflightMetadata {
  expectedPrismaRef: string;
}

function metadataBody(value: unknown): value is PreflightMetadata {
  if (typeof value !== "object" || value === null) return false;
  if (Object.keys(value).join(",") !== "expectedPrismaRef") return false;
  return "expectedPrismaRef" in value && validPrismaRef(value.expectedPrismaRef);
}

/** Decode verified-artifact metadata, never SQL or caller-selected connectivity. */
export function parsePreflightMetadata(raw: string): PreflightMetadata | undefined {
  if (new TextEncoder().encode(raw).byteLength > MAX_PREFLIGHT_BYTES) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    return metadataBody(value) ? { expectedPrismaRef: value.expectedPrismaRef } : undefined;
  } catch {
    return undefined;
  }
}
