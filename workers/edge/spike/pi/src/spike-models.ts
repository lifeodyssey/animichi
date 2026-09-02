// W0-S1 spike (#1244): the three-provider matrix, registered through
// `createProvider` custom Models.
//
// Two deliberate choices, both from the 2026-09-01 pi-agent-core research
// report (the decision input for #1243):
//   - the api modules are imported from their NON-lazy subpaths. Importing
//     `@earendil-works/pi-ai/api/<id>.lazy` (which every built-in provider
//     factory does) trips an esbuild chunk-init bug — `ModelsImpl is not a
//     constructor` at runtime — under both standalone esbuild and wrangler
//     (report §4.3). That is why the providers are hand-rolled here.
//   - no `compat` overrides on the mimo model by default: the working default
//     is pi's own auto-detection from the baseUrl. W0-S2 (#1245) measures the
//     dialect switches by passing an explicit override set per request, which
//     is what `mimoRouteNamed` + the `compat` argument below exist for; the S1
//     turn routes still go through the no-override path.
//
// Keys arrive as Worker secrets and are read here only to hand to pi. They are
// never logged, never echoed in a response, and `configuredProviders` reports
// presence as a boolean.

import {
  createModels,
  createProvider,
  type Api,
  type Model,
  type MutableModels,
  type ProviderStreams,
} from "@earendil-works/pi-ai";
import { stream, streamSimple } from "@earendil-works/pi-ai/api/openai-completions";
import {
  stream as anthropicStream,
  streamSimple as anthropicStreamSimple,
} from "@earendil-works/pi-ai/api/anthropic-messages";
import {
  stream as googleStream,
  streamSimple as googleStreamSimple,
} from "@earendil-works/pi-ai/api/google-generative-ai";
import type { MimoCompat, MimoRouteName } from "./compat-switch.ts";
import type { SpikeProvider } from "./turn-command.ts";

export interface ProviderKeys {
  MIMO_API_KEY?: string;
  ZEN_GO_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  GEMINI_API_KEY?: string;
}

export interface MimoRoute {
  baseUrl: string;
  apiKey: string;
  /** Which Worker secret supplied the key — a label, never the value. */
  secretName: string;
}

export const MIMO_DIRECT_BASE_URL = "https://api.xiaomimimo.com/v1";
export const MIMO_ZEN_BASE_URL = "https://opencode.ai/zen/go/v1";

/**
 * staging routes mimo two ways (workers/edge/wrangler.toml): the direct MiMo
 * endpoint under MIMO_API_KEY, the zen/go gateway under ZEN_GO_API_KEY. Direct
 * wins when both are present, matching DEFAULT_AGENT_MODEL.
 */
export function mimoRouteOf(keys: ProviderKeys): MimoRoute | null {
  return mimoRouteNamed(keys, "direct") ?? mimoRouteNamed(keys, "zen");
}

/**
 * The route the S2 matrix asked for by name, rather than by preference order:
 * a measured row must say which gateway produced it, so falling back would
 * mislabel the row.
 */
export function mimoRouteNamed(keys: ProviderKeys, name: MimoRouteName): MimoRoute | null {
  if (name === "direct" && keys.MIMO_API_KEY) {
    return { baseUrl: MIMO_DIRECT_BASE_URL, apiKey: keys.MIMO_API_KEY, secretName: "MIMO_API_KEY" };
  }
  if (name === "zen" && keys.ZEN_GO_API_KEY) {
    return { baseUrl: MIMO_ZEN_BASE_URL, apiKey: keys.ZEN_GO_API_KEY, secretName: "ZEN_GO_API_KEY" };
  }
  return null;
}

/** Presence of each route's key as a boolean — never the key itself. */
export function configuredMimoRoutes(keys: ProviderKeys): Record<MimoRouteName, boolean> {
  return {
    direct: mimoRouteNamed(keys, "direct") !== null,
    zen: mimoRouteNamed(keys, "zen") !== null,
  };
}

export function configuredProviders(keys: ProviderKeys): Record<SpikeProvider, boolean> {
  return {
    mimo: mimoRouteOf(keys) !== null,
    anthropic: Boolean(keys.ANTHROPIC_API_KEY),
    gemini: Boolean(keys.GEMINI_API_KEY),
  };
}

/** Resolves to exactly the key it was handed — never to an ambient credential. */
export function fixedKeyAuth(name: string, apiKey: string) {
  return { apiKey: { name, resolve: () => Promise.resolve({ auth: { apiKey }, source: name }) } };
}

// Everything about the mimo model except which gateway it is pointed at.
const MIMO_MODEL: Omit<Model<"openai-completions">, "baseUrl"> = {
  id: "mimo-v2.5",
  name: "MiMo v2.5",
  api: "openai-completions",
  provider: "mimo",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128000,
  maxTokens: 32000,
};

// An empty override set is left off the model entirely rather than passed as
// `{}`, so the S1 turn route keeps the exact shape it was measured with.
function mimoModel(baseUrl: string, compat: MimoCompat): Model<"openai-completions"> {
  const model = { ...MIMO_MODEL, baseUrl };
  return Object.keys(compat).length === 0 ? model : { ...model, compat };
}

const anthropicModel: Model<"anthropic-messages"> = {
  id: "claude-haiku-4-5",
  name: "Claude Haiku 4.5",
  api: "anthropic-messages",
  provider: "anthropic",
  baseUrl: "https://api.anthropic.com",
  reasoning: true,
  input: ["text", "image"],
  cost: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  contextWindow: 200000,
  maxTokens: 64000,
};

const geminiModel: Model<"google-generative-ai"> = {
  id: "gemini-2.5-flash",
  name: "Gemini 2.5 Flash",
  api: "google-generative-ai",
  provider: "gemini",
  baseUrl: "https://generativelanguage.googleapis.com/v1beta",
  reasoning: true,
  input: ["text", "image"],
  cost: { input: 0.3, output: 2.5, cacheRead: 0.03, cacheWrite: 0 },
  contextWindow: 1048576,
  maxTokens: 65536,
};

/** One provider of the matrix, ready to register: its model, key and adapter. */
interface SpikeProviderSpec {
  model: Model<Api>;
  secretName: string;
  apiKey: string;
  api: ProviderStreams;
}

function register(models: MutableModels, spec: SpikeProviderSpec): void {
  models.setProvider(
    createProvider({
      id: spec.model.provider,
      name: spec.model.name,
      baseUrl: spec.model.baseUrl,
      auth: fixedKeyAuth(spec.secretName, spec.apiKey),
      models: [spec.model],
      api: spec.api,
    }),
  );
}

function mimoSpec(route: MimoRoute, compat: MimoCompat): SpikeProviderSpec {
  return {
    model: mimoModel(route.baseUrl, compat),
    secretName: route.secretName,
    apiKey: route.apiKey,
    api: { stream, streamSimple },
  };
}

function anthropicSpec(apiKey: string): SpikeProviderSpec {
  return {
    model: anthropicModel,
    secretName: "ANTHROPIC_API_KEY",
    apiKey,
    api: { stream: anthropicStream, streamSimple: anthropicStreamSimple },
  };
}

function geminiSpec(apiKey: string): SpikeProviderSpec {
  return {
    model: geminiModel,
    secretName: "GEMINI_API_KEY",
    apiKey,
    api: { stream: googleStream, streamSimple: googleStreamSimple },
  };
}

function specsFor(keys: ProviderKeys): SpikeProviderSpec[] {
  const specs: SpikeProviderSpec[] = [];
  const mimo = mimoRouteOf(keys);
  if (mimo) specs.push(mimoSpec(mimo, {}));
  if (keys.ANTHROPIC_API_KEY) specs.push(anthropicSpec(keys.ANTHROPIC_API_KEY));
  if (keys.GEMINI_API_KEY) specs.push(geminiSpec(keys.GEMINI_API_KEY));
  return specs;
}

export function createSpikeModels(keys: ProviderKeys): MutableModels {
  const models = createModels();
  for (const spec of specsFor(keys)) register(models, spec);
  return models;
}

/**
 * W0-S2 (#1245): one mimo provider on the named route, carrying the compat
 * overrides under measurement. Only mimo is registered — the other two
 * providers have nothing to say about the mimo gateway dialect.
 */
export function createMimoCompatModels(route: MimoRoute, compat: MimoCompat): MutableModels {
  const models = createModels();
  register(models, mimoSpec(route, compat));
  return models;
}

const MODEL_IDS: Record<SpikeProvider, string> = {
  mimo: "mimo-v2.5",
  anthropic: "claude-haiku-4-5",
  gemini: "gemini-2.5-flash",
};

export function modelFor(models: MutableModels, provider: SpikeProvider): Model<Api> | undefined {
  return models.getModel(provider, MODEL_IDS[provider]);
}
