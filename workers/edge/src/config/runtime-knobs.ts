/// <reference types="@cloudflare/workers-types" />

/**
 * Runtime-tunable operational knobs (issue #688). An operator stores a value in
 * the `EDGE_KNOBS` KV namespace and the edge reads it per request through a
 * short in-isolate cache, so tuning an operational number takes seconds instead
 * of the ~15-minute deploy chain an env var costs.
 *
 * The store is a FALLBACK LAYER, never the source of truth: an absent key, a
 * value the knob cannot parse, or a store that throws all resolve to the
 * existing env var, which is the behavior the deployed configuration already
 * pins. That is why the reader takes a `RuntimeKnob` token instead of an env
 * var name — the set of readable names is closed at construction, and the
 * deploy-coupled gates (identity, exposure, showcase) are refused here rather
 * than trusted to a caller's discipline.
 */

/** The store surface the reader needs; a Cloudflare `KVNamespace` satisfies it. */
export interface KnobStore {
  get(key: string): Promise<string | null>;
}

/** The environment surface the reader reads: the knob store binding plus the
 * env var each knob falls back to. `Env` is assignable to this shape. */
export interface KnobEnvironment {
  readonly EDGE_KNOBS?: KnobStore;
  readonly [name: string]: unknown;
}

/** One runtime-tunable knob. `parse` answers `undefined` for a malformed stored
 * value, which is what sends the reader to `fromEnv`. */
export interface RuntimeKnob<T> {
  readonly envVar: string;
  readonly kvKey: string;
  parse(raw: string): T | undefined;
  fromEnv(raw: string | undefined): T;
}

/** Identity, exposure and showcase gates stay deployment-coupled: opening the
 * front door, publishing the landing-only production surface, or moving the
 * JWT issuer are all reviewed deploys, never a KV write (AUTH-2 #950, S0-v2
 * C9). The reader refuses these names, so a store value can never answer for
 * one. The inventory classifies them in `edge-vars.ts`. */
export const DEPLOY_COUPLED_VARS: ReadonlySet<string> = new Set([
  "ANON_ACCESS_ENABLED",
  "ANON_ID_SECRET",
  "TURNSTILE_SECRET",
  "EDGE_SHOWCASE_MODE",
  "NEON_AUTH_JWKS_URL",
]);

/** Build a knob, refusing a descriptor for a deploy-coupled gate. The refusal
 * happens at construction, so the mistake fails the isolate at import rather
 * than the request that would have read it. */
export function runtimeKnob<T>(descriptor: RuntimeKnob<T>): RuntimeKnob<T> {
  if (DEPLOY_COUPLED_VARS.has(descriptor.envVar)) {
    throw new Error(`${descriptor.envVar} is deploy-coupled and cannot be read from the knob store`);
  }
  return descriptor;
}

/** The upper bound on how long one isolate serves a cached resolution. KV's own
 * edge cache is 60 s, so a shorter TTL keeps a flip visible sooner than the
 * platform alone would. */
export const KNOB_CACHE_TTL_MS = 30_000;

export interface KnobReaderOptions {
  readonly now: () => number;
  /** Overrides `KNOB_CACHE_TTL_MS`; the integration lane shrinks it. */
  readonly ttlMs?: number;
}

export interface KnobReader {
  read<T>(environment: KnobEnvironment, knob: RuntimeKnob<T>): Promise<T>;
}

interface CachedResolution {
  readonly value: unknown;
  readonly expiresAt: number;
}

/**
 * A reader bound to one isolate's cache. `read` resolves the stored value,
 * falls back to the env var when the store is absent, the key is missing, the
 * value is malformed or the read throws, and caches the answer for at most
 * `ttlMs`.
 */
export function createKnobReader(options: KnobReaderOptions): KnobReader {
  const ttlMs = options.ttlMs ?? KNOB_CACHE_TTL_MS;
  const cache = new Map<string, CachedResolution>();
  return {
    async read<T>(environment: KnobEnvironment, knob: RuntimeKnob<T>): Promise<T> {
      const now = options.now();
      const cached = cache.get(knob.kvKey);
      if (cached !== undefined && cached.expiresAt > now) return cached.value as T;
      const value = await resolveStoredOrEnv(environment, knob);
      cache.set(knob.kvKey, { value, expiresAt: now + ttlMs });
      return value;
    },
  };
}

async function resolveStoredOrEnv<T>(environment: KnobEnvironment, knob: RuntimeKnob<T>): Promise<T> {
  const stored = await storedText(environment.EDGE_KNOBS, knob.kvKey);
  const parsed = stored === undefined ? undefined : knob.parse(stored);
  return parsed ?? knob.fromEnv(envText(environment, knob.envVar));
}

/** A store read that never throws into admission: an unreachable KV is the
 * "absent" case, which the env fallback already answers. */
async function storedText(store: KnobStore | undefined, key: string): Promise<string | undefined> {
  if (store === undefined) return undefined;
  try {
    return (await store.get(key)) ?? undefined;
  } catch {
    return undefined;
  }
}

function envText(environment: KnobEnvironment, name: string): string | undefined {
  const value = environment[name];
  return typeof value === "string" ? value : undefined;
}
