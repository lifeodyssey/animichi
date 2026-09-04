/**
 * The model ONE turn runs on when the caller brought their own key (W2-3
 * #1289, spec §四 S5 + Appendix D).
 *
 * A sibling of `session/turn-model.ts`, chosen per turn rather than per
 * deployment, and structurally incapable of the fallback the red line
 * forbids: nothing in this module reads the Worker environment, so there is no
 * server credential in scope for pi to reach for even if one wanted it. The
 * key it hands `createProvider` is the one the caller sent, resolved by a
 * fixed auth that answers with exactly that value.
 *
 * EVERY PROVIDER REQUEST GOES THROUGH `GuardedFetch`. pi's
 * `ProviderRequestOptions.fetch` is the seam — the openai-completions and
 * anthropic-messages adapters both thread it into the SDK client they build
 * (`dist/api/openai-completions.js:202,577`,
 * `dist/api/anthropic-messages.js:368,683,722`), so the SDK's own retries and
 * follow-ups are covered too, not just the first call. It is carried on the
 * `TurnModel` rather than baked into the provider because `createProvider`
 * has no `fetch` field at all (`dist/models.d.ts` `CreateProviderOptions`):
 * the only place pi accepts one is per request, which is why `turn-agent.ts`
 * injects it in its `streamFn`.
 *
 * A NEW REGISTRY PER TURN, never a shared one. A `MutableModels` keyed by
 * provider id would otherwise let one caller's turn overwrite another's
 * provider entry — the credential is per turn, so its registry is too.
 */
import {
  createModels,
  createProvider,
  type Api,
  type Model,
  type ProviderStreams,
} from "@earendil-works/pi-ai";
import { stream, streamSimple } from "@earendil-works/pi-ai/api/openai-completions";
import {
  stream as anthropicStream,
  streamSimple as anthropicStreamSimple,
} from "@earendil-works/pi-ai/api/anthropic-messages";
import type { EgressPolicy } from "../egress/egress-policy.ts";
import { GuardedFetch, type EgressFetch } from "../egress/guarded-fetch.ts";
import { SecretScrub } from "../egress/secret-scrub.ts";
import type { TurnModel } from "../session/turn-model.ts";
import type { ByokCredential } from "./byok-credential.ts";
import { BYOK_DIALECTS, type ByokApi } from "./byok-family.ts";

/**
 * The eager api subpaths, never `.lazy` — the esbuild chunk-init bug reported
 * in `docs/specs/2026-09-01-pi-ai-esbuild-lazy-chunk-report.md` and held by
 * the `test:bundle-smoke` gate.
 */
const BYOK_APIS: Readonly<Record<ByokApi, ProviderStreams>> = {
  "openai-completions": { stream, streamSimple },
  "anthropic-messages": { stream: anthropicStream, streamSimple: anthropicStreamSimple },
};

/** Where the guarded fetch sends what it allows; both injectable for tests. */
export interface ByokEgress {
  readonly policy?: EgressPolicy;
  readonly inner?: EgressFetch;
}

/** Resolves to exactly the key it was handed — never an ambient credential. */
function callerKeyAuth(credential: ByokCredential) {
  const name = `byok:${credential.family}`;
  const resolve = () => Promise.resolve({ auth: { apiKey: credential.secret }, source: name });
  return { apiKey: { name, resolve } };
}

/**
 * `input` declares images even though a turn sends none today: the probe's one
 * message carries an image part, and pi drops a part the model does not claim
 * to accept — which would make every credential look vision-capable.
 */
function byokModel(credential: ByokCredential): Model<Api> {
  const dialect = BYOK_DIALECTS[credential.family];
  return {
    id: credential.modelId,
    name: credential.modelId,
    api: dialect.api,
    provider: credential.provider,
    baseUrl: credential.baseUrl,
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: dialect.contextWindow,
    maxTokens: dialect.maxTokens,
  };
}

function byokProvider(credential: ByokCredential, model: Model<Api>) {
  return createProvider({
    id: credential.provider,
    name: credential.family,
    baseUrl: credential.baseUrl,
    auth: callerKeyAuth(credential),
    models: [model],
    api: BYOK_APIS[BYOK_DIALECTS[credential.family].api],
  });
}

/** One throwaway provider carrying only this turn's credential. */
export function byokTurnModel(credential: ByokCredential, egress: ByokEgress = {}): TurnModel {
  const model = byokModel(credential);
  const registry = createModels();
  registry.setProvider(byokProvider(credential, model));
  const scrub = new SecretScrub([credential.secret]);
  return { registry, model, fetch: guardedFetchFor(credential, egress), scrub };
}

function guardedFetchFor(credential: ByokCredential, egress: ByokEgress): EgressFetch {
  return new GuardedFetch({
    provider: credential.provider,
    key: credential.secret,
    policy: egress.policy,
    inner: egress.inner,
  }).fetch;
}
