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
//   - no `compat` overrides on the mimo model: S2 (#1245) owns the gateway
//     dialect switches, and the report's working default is pi's own
//     auto-detection from the baseUrl.
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
  const { MIMO_API_KEY, ZEN_GO_API_KEY } = keys;
  if (MIMO_API_KEY) {
    return { baseUrl: MIMO_DIRECT_BASE_URL, apiKey: MIMO_API_KEY, secretName: "MIMO_API_KEY" };
  }
  if (ZEN_GO_API_KEY) {
    return { baseUrl: MIMO_ZEN_BASE_URL, apiKey: ZEN_GO_API_KEY, secretName: "ZEN_GO_API_KEY" };
  }
  return null;
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

function mimoModel(baseUrl: string): Model<"openai-completions"> {
  return {
    id: "mimo-v2.5",
    name: "MiMo v2.5",
    api: "openai-completions",
    provider: "mimo",
    baseUrl,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 32000,
  };
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

function mimoSpec(route: MimoRoute): SpikeProviderSpec {
  return {
    model: mimoModel(route.baseUrl),
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
  if (mimo) specs.push(mimoSpec(mimo));
  if (keys.ANTHROPIC_API_KEY) specs.push(anthropicSpec(keys.ANTHROPIC_API_KEY));
  if (keys.GEMINI_API_KEY) specs.push(geminiSpec(keys.GEMINI_API_KEY));
  return specs;
}

export function createSpikeModels(keys: ProviderKeys): MutableModels {
  const models = createModels();
  for (const spec of specsFor(keys)) register(models, spec);
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
