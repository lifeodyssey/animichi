import { SecretScrub } from "../egress/secret-scrub.ts";
import { createModels, InMemoryCredentialStore, type Api, type Model } from "@earendil-works/pi-ai";
import { opencodeGoProvider } from "@earendil-works/pi-ai/providers/opencode-go";
import { createOperationModels } from "@animichi/agent/models";
import { BYOK_DIALECTS, type ByokApi } from "../byok/byok-family.ts";
import type { ByokCredentialParts } from "../byok/byok-credential.ts";

/** The two published OpenCode Go APIs the native operation can stream. */
type NativeApi = "openai-completions" | "anthropic-messages";

function isNativeApi(model: Model<Api>): model is Model<NativeApi> {
  return model.api === "openai-completions" || model.api === "anthropic-messages";
}

/**
 * OpenCode Go refuses a request without its session header (HTTP 400
 * `MissingSessionID`), exactly as its own clients send it. One host incarnation
 * is one session, so the identifier is fresh per host and stable across its turns.
 */
function opencodeGoSession() {
  return { "x-opencode-session": crypto.randomUUID() };
}

/**
 * Published model metadata owns pricing and dialect; credentials never consult ambient environment.
 * The default turn answers on OpenCode Go's published `mimo-v2.6-flash`, never the direct Xiaomi
 * provider, and its session-routing header is declared once for the whole operation (#1974).
 */
export async function nativeHostModels(key: string | undefined, fetch: typeof globalThis.fetch = globalThis.fetch) {
  const provider = opencodeGoProvider();
  const published = provider.getModels().filter(isNativeApi);
  const model = published.find((candidate) => candidate.id === "mimo-v2.6-flash");
  if (!model) throw new Error("The published OpenCode Go model is unavailable");
  const models = key?.trim() ? await createOperationModels(model, key, fetch, opencodeGoSession())
    : createModels({ credentials: new InMemoryCredentialStore(), authContext: { env: () => Promise.resolve(undefined), fileExists: () => Promise.resolve(false) } });
  if (!key?.trim()) models.setProvider(provider);
  return { models, model, scrub: new SecretScrub(key ? [key] : []), available: Boolean(key?.trim()) };
}

/** The request credential is a transient RPC input, never part of a native operation or business row. */
export async function nativeByokModels(credential: ByokCredentialParts, fetch: typeof globalThis.fetch = globalThis.fetch) {
  const dialect = BYOK_DIALECTS[credential.family];
  if (credential.provider !== dialect.provider) throw new Error("BYOK provider does not match its dialect");
  const model: Model<ByokApi> = { id: credential.modelId, name: credential.modelId, provider: credential.provider,
    api: dialect.api, baseUrl: credential.baseUrl, reasoning: false, input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: dialect.contextWindow, maxTokens: dialect.maxTokens };
  return { model, scrub: new SecretScrub([credential.secret]), models: await createOperationModels(model, credential.secret, fetch) };
}

export type NativeModelResources = Awaited<ReturnType<typeof nativeHostModels>>;
