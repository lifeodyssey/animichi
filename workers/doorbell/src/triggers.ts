import { isRecord } from "./http";

/** Components the doorbell may start Builds for (never itself). */
export type ComponentName = "catalog" | "users" | "web" | "root" | "jobs";

export type TriggerMap = Partial<Record<ComponentName, string>>;

const KNOWN_COMPONENTS: readonly ComponentName[] = ["catalog", "users", "web", "root", "jobs"];

/**
 * Parse a committed trigger map JSON string: pick known keys whose values are
 * non-empty strings. Invalid JSON or non-objects → empty map (env config fails
 * closed as unknown component).
 */
export function parseTriggerMap(raw: string | undefined): TriggerMap {
  if (raw === undefined) return {};
  const parsed = tryParseJson(raw);
  if (!isRecord(parsed)) return {};
  return Object.fromEntries(knownEntries(parsed));
}

export function tryParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function knownEntries(record: Record<string, unknown>): [ComponentName, string][] {
  const entries: [ComponentName, string][] = [];
  for (const component of KNOWN_COMPONENTS) {
    const value = record[component];
    if (typeof value === "string" && value.length > 0) entries.push([component, value]);
  }
  return entries;
}

export function triggerIdFor(map: TriggerMap, component: string): string | null {
  const known = KNOWN_COMPONENTS.find((entry) => entry === component);
  if (known === undefined) return null;
  return map[known] ?? null;
}

/**
 * Select the ring's trigger map from the OIDC environment claim (never from
 * the request). Any other environment → empty map.
 */
export function mapForEnvironment(
  env: { STAGING_TRIGGER_MAP?: string; PRODUCTION_TRIGGER_MAP?: string },
  environmentClaim: string | undefined,
): TriggerMap {
  if (environmentClaim === "staging") return parseTriggerMap(env.STAGING_TRIGGER_MAP);
  if (environmentClaim === "production") return parseTriggerMap(env.PRODUCTION_TRIGGER_MAP);
  return {};
}
