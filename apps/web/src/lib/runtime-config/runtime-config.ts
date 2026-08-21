import { z } from "zod";

/**
 * Versioned runtime configuration (animichi issue #1013, AC1).
 *
 * The ONE built web artifact loads its environment-varying PUBLIC configuration
 * at runtime from a versioned contract instead of baking staging/production
 * values into the bundle via VITE_* build-time injection. Server-side secrets
 * never belong here — this schema is public by definition (origins, feature
 * flags, public site keys, an analytics identifier). Anything secret stays in
 * server env / Cloudflare secrets.
 *
 * A payload is rejected (fail-closed) when it carries the wrong schema version,
 * an unknown top-level field, or a malformed required field. A missing payload
 * degrades to {@link DEFAULT_RUNTIME_CONFIG} (defaults on missing config).
 */

/** The only schema version this loader understands. */
export const RUNTIME_CONFIG_SCHEMA_VERSION = 1 as const;

const UrlOptional = z.url().optional();

const ApiSchema = z
  .object({
    /** Served-origin override (falls back to the request origin at runtime). */
    siteOrigin: UrlOptional,
    catalogUrl: UrlOptional,
    usersUrl: UrlOptional,
    agentUrl: UrlOptional,
  })
  .strict();

const BeaconTokenSchema = z.string().nonempty();

/** Public Turnstile site key shape — exactly 24 chars, matching
 * TurnstileGate.tsx `SITE_KEY_LENGTH` (test keys `1x…AA` and live
 * `0x4AAAAAA…` keys, which may include hyphens). A 35-char SECRET must
 * still fail closed here rather than ship in the client bundle. */
const TurnstileSiteKeySchema = z.string().regex(/^[A-Za-z0-9-]{24}$/);

/** Exactly the strict camel-case boolean string the landing branch reads. */
const ShowcaseModeSchema = z.literal("false").or(z.literal("true"));

const FeatureFlagsSchema = z.record(z.string(), z.boolean());

export const runtimeConfigSchema = z
  .object({
    schemaVersion: z.literal(RUNTIME_CONFIG_SCHEMA_VERSION),
    api: ApiSchema.optional().default({}),
    neonAuthBaseUrl: UrlOptional,
    turnstileSiteKey: TurnstileSiteKeySchema.optional(),
    showcaseMode: ShowcaseModeSchema,
    cfBeaconToken: BeaconTokenSchema.optional(),
    featureFlags: FeatureFlagsSchema.optional().default({}),
  })
  .strict();

export type RuntimeFeatureFlags = Readonly<Record<string, boolean>>;

export interface RuntimeApiConfig {
  readonly siteOrigin?: string;
  readonly catalogUrl?: string;
  readonly usersUrl?: string;
  readonly agentUrl?: string;
}

export interface RuntimeConfig {
  readonly schemaVersion: typeof RUNTIME_CONFIG_SCHEMA_VERSION;
  readonly api: Readonly<RuntimeApiConfig>;
  readonly neonAuthBaseUrl?: string;
  readonly turnstileSiteKey?: string;
  readonly showcaseMode: "true" | "false";
  readonly cfBeaconToken?: string;
  readonly featureFlags: Readonly<RuntimeFeatureFlags>;
}

/** Fail-closed contract: a present-but-invalid payload refuses to load. */
export type RuntimeConfigErrorCode = "invalid_json" | "wrong_version" | "unknown_field" | "invalid";

export function runtimeConfigErrorMessage(code: RuntimeConfigErrorCode, detail: string): string {
  return `runtime config ${code}: ${detail}`;
}

export function parseRuntimeConfig(raw: unknown): RuntimeConfig {
  if (raw === undefined || raw === null) return DEFAULT_RUNTIME_CONFIG;
  return parseObject(asObject(raw));
}

function asObject(raw: unknown): unknown {
  if (typeof raw === "string") return parseJson(raw);
  return raw;
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new RuntimeConfigError("invalid_json", "value is not valid JSON");
  }
}

type SchemaOutput = z.infer<typeof runtimeConfigSchema>;

function parseObject(value: unknown): RuntimeConfig {
  if (!isRecord(value)) throw new RuntimeConfigError("invalid", "config must be a JSON object");
  if (value.schemaVersion !== RUNTIME_CONFIG_SCHEMA_VERSION) {
    throw new RuntimeConfigError("wrong_version", "unsupported schemaVersion");
  }
  const result = runtimeConfigSchema.safeParse(value);
  if (!result.success) throw mapZodFailure(result.error.issues);
  return toRuntimeConfig(result.data);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toRuntimeConfig(data: SchemaOutput): RuntimeConfig {
  return { schemaVersion: RUNTIME_CONFIG_SCHEMA_VERSION, api: data.api,
    neonAuthBaseUrl: data.neonAuthBaseUrl, turnstileSiteKey: data.turnstileSiteKey,
    showcaseMode: data.showcaseMode, cfBeaconToken: data.cfBeaconToken, featureFlags: data.featureFlags };
}

function mapZodFailure(issues: readonly { readonly code: string }[]): RuntimeConfigError {
  if (issues.some((issue) => issue.code === "unrecognized_keys")) {
    return new RuntimeConfigError("unknown_field", "config carries fields outside the schema");
  }
  return new RuntimeConfigError("invalid", issues.map((issue) => issue.code).join(","));
}

class RuntimeConfigError extends Error {
  readonly code: RuntimeConfigErrorCode;
  constructor(code: RuntimeConfigErrorCode, message: string) {
    super(runtimeConfigErrorMessage(code, message));
    this.name = "RuntimeConfigError";
    this.code = code;
  }
}

export const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  schemaVersion: RUNTIME_CONFIG_SCHEMA_VERSION,
  api: {},
  showcaseMode: "false",
  featureFlags: {},
};
