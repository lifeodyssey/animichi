// W0-S5 spike (#1248): a pi provider built entirely from ONE request's BYOK
// fields — family, base URL, key — and wired to the guarded fetch.
//
// Nothing here reads a Worker secret. That is the point: the "no server-key
// fallback" red line is structural, because there is no env-shaped credential
// in scope for pi to fall back to even if `EgressPolicy` let an empty key past.
//
// Two notes on the api adapters:
//   - the `.lazy` subpaths stay unimported, for the esbuild chunk-init reason
//     `spike-models.ts` documents.
//   - the `google-generative-ai` adapter REFUSES an injected fetch — it throws
//     "Custom fetch is not supported by the Google Generative AI adapter"
//     (node_modules/@earendil-works/pi-ai/dist/api/google-generative-ai.js:33).
//     So the guard cannot hang on that adapter at all, and the google family is
//     driven through Google's OpenAI-compatible surface on the same host
//     (`/v1beta/openai`) instead. That is a finding for W2's BYOK card, not an
//     incidental choice.

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
import type { ByokProvider } from "../../../src/agent/egress/provider-allowlist.ts";
import { fixedKeyAuth } from "./spike-models.ts";

const OPENAI_COMPLETIONS: ProviderStreams = { stream, streamSimple };
const ANTHROPIC_MESSAGES: ProviderStreams = {
  stream: anthropicStream,
  streamSimple: anthropicStreamSimple,
};

interface ByokDialect {
  modelId: string;
  contextWindow: number;
  api: ProviderStreams;
  modelOf: (provider: ByokProvider, baseUrl: string) => Model<Api>;
}

const DIALECTS: Readonly<Record<ByokProvider, ByokDialect>> = {
  openai: {
    modelId: "gpt-4o-mini",
    contextWindow: 128000,
    api: OPENAI_COMPLETIONS,
    modelOf: (provider, baseUrl) => openaiCompletionsModel(provider, baseUrl),
  },
  anthropic: {
    modelId: "claude-haiku-4-5",
    contextWindow: 200000,
    api: ANTHROPIC_MESSAGES,
    modelOf: (_provider, baseUrl) => anthropicMessagesModel(baseUrl),
  },
  google: {
    modelId: "gemini-2.5-flash",
    contextWindow: 1048576,
    api: OPENAI_COMPLETIONS,
    modelOf: (provider, baseUrl) => openaiCompletionsModel(provider, baseUrl),
  },
};

export interface ByokModel {
  models: MutableModels;
  model: Model<Api>;
}

/** The fields every dialect shares; only `id`/`api`/`provider` differ. */
function modelShapeOf(provider: ByokProvider, baseUrl: string) {
  const dialect = DIALECTS[provider];
  const input: ("text" | "image")[] = ["text"];
  return {
    id: dialect.modelId,
    name: dialect.modelId,
    baseUrl,
    reasoning: false,
    input,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: dialect.contextWindow,
    maxTokens: 1024,
  };
}

function openaiCompletionsModel(provider: ByokProvider, baseUrl: string): Model<"openai-completions"> {
  return { ...modelShapeOf(provider, baseUrl), api: "openai-completions", provider };
}

function anthropicMessagesModel(baseUrl: string): Model<"anthropic-messages"> {
  return { ...modelShapeOf("anthropic", baseUrl), api: "anthropic-messages", provider: "anthropic" };
}

/** Registers one throwaway provider carrying only this request's credential. */
export function byokModelOf(provider: ByokProvider, baseUrl: string, key: string): ByokModel {
  const dialect = DIALECTS[provider];
  const model = dialect.modelOf(provider, baseUrl);
  const models = createModels();
  const auth = fixedKeyAuth(`byok:${provider}`, key);
  const spec = { id: provider, name: provider, baseUrl, auth, models: [model], api: dialect.api };
  models.setProvider(createProvider(spec));
  return { models, model };
}
