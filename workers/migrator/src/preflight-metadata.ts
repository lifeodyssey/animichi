import { validPrismaRef } from "./prisma-target";

export const MAX_PREFLIGHT_BYTES = 65_536;

/**
 * The migration request body. One schema identity selects what applies (#1634); the Atlas
 * chain head, its checksum file and the per-file entry list left with the apply engine that
 * read them. The key set is compared EXACTLY, so an extra or missing key is an invalid
 * request rather than a silently ignored field — which is why sender and receiver can only
 * change together.
 */
export interface PreflightMetadata {
  stagingOnlyBaseline: boolean;
  expectedPrismaRef: string;
}

function metadataKeys(value: object): boolean {
  return Object.keys(value).sort().join(",") === "expectedPrismaRef,stagingOnlyBaseline";
}

function metadataBody(value: unknown): value is PreflightMetadata {
  if (typeof value !== "object" || value === null || !metadataKeys(value)) return false;
  return "expectedPrismaRef" in value && validPrismaRef(value.expectedPrismaRef) &&
    "stagingOnlyBaseline" in value && typeof value.stagingOnlyBaseline === "boolean";
}

/** Decode verified-artifact metadata, never SQL or caller-selected connectivity. */
export function parsePreflightMetadata(raw: string): PreflightMetadata | undefined {
  if (new TextEncoder().encode(raw).byteLength > MAX_PREFLIGHT_BYTES) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    return metadataBody(value) ? { stagingOnlyBaseline: value.stagingOnlyBaseline, expectedPrismaRef: value.expectedPrismaRef } : undefined;
  } catch {
    return undefined;
  }
}
