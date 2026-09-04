/**
 * The model one turn runs on: mimo-v2.5, direct, through a `createProvider`
 * custom Model (card #1252, spec
 * `docs/specs/2026-09-01-agent-ts-rewrite-spec.md` §三 "pi Agent（mimo-v2.5 经
 * `createProvider` custom Model）").
 *
 * Three of the decisions here were measured rather than chosen, and each has a
 * spike behind it:
 * - **no `compat` overrides.** W0-S2 (Appendix B) ran 19 direct cases — the
 *   default plus nine switches at both values — and every one completed a tool
 *   round trip with streaming usage. pi's `detectCompat()` does not recognise
 *   `api.xiaomimimo.com` and falls back to the `api.openai.com` defaults, which
 *   is exactly what works. Adding a switch here would be undoing a measurement.
 * - **the eager `api/openai-completions` import**, never the `.lazy` subpath:
 *   the lazy one trips an esbuild chunk-init bug (`ModelsImpl is not a
 *   constructor`) under both esbuild and wrangler, reported in
 *   `docs/specs/2026-09-01-pi-ai-esbuild-lazy-chunk-report.md`. The
 *   `test:bundle-smoke` gate holds this line for every bundled edge source.
 * - **the direct route**, not zen: W1 ships direct because that is the route
 *   S2 actually measured (`ZEN_GO_API_KEY` was absent, so zen stays untested).
 *
 * The key is read only to hand to pi. It is never logged, never echoed, and
 * `fixedKeyAuth` resolves to exactly the key it was given rather than to any
 * ambient credential.
 */
import {
  createModels,
  createProvider,
  type Api,
  type Model,
  type ModelsSimpleStreamOptions,
  type MutableModels,
} from "@earendil-works/pi-ai";
import { stream, streamSimple } from "@earendil-works/pi-ai/api/openai-completions";
import { GuardedFetch, type EgressFetch } from "../egress/guarded-fetch.ts";
import { EgressPolicy } from "../egress/egress-policy.ts";
import { ProviderAllowlist, type ByokProvider } from "../egress/provider-allowlist.ts";
import type { SecretScrub } from "../egress/secret-scrub.ts";

/**
 * WHAT ONE TURN RUNS ON — the registry, the model inside it, and the fetch its
 * provider requests go out through, as one value.
 *
 * The three travel together because a turn cannot use one without the others:
 * pi resolves a model against the registry that published it, and a fetch
 * injected for a DIFFERENT provider's credential would be a guard pointed at
 * the wrong allowlist. Since W2-3 (#1289) there are two producers — the server
 * key's `mimoTurnModel` here, and `byok/byok-turn-model.ts`'s per-turn one —
 * and this shape is the whole contract between them and `turn-agent.ts`.
 *
 * `fetch` and `scrub` are absent for the server-key model on purpose: mimo is
 * our own configured endpoint, not a caller-chosen one, so there is nothing
 * for the BYOK egress guard to decide about it, and no caller secret for a
 * scrub to redact. They live HERE rather than beside them because whoever
 * knows the credential is the only thing that can produce either: the guard is
 * pointed at that credential's allowlist and the scrub is seeded with its key.
 */
export interface TurnModel {
  readonly registry: MutableModels;
  readonly model: Model<Api>;
  /** Whether this model spends the CALLER's own credential. The loop refuses
   * to drive a run committed as `payer = 'byok'` on a model for which this is
   * false — spec §四 S5's "无 server-key fallback", held on the DO side rather
   * than only at the request that opened the turn (#1289). */
  readonly callerKeyed: boolean;
  readonly fetch?: EgressFetch;
  /** Runs over this turn's frames and provider error text before either can
   * reach a log or the wire. */
  readonly scrub?: SecretScrub;
}

/** The direct MiMo endpoint, the one W0-S2 measured (Appendix B). */
export const MIMO_DIRECT_BASE_URL = "https://api.xiaomimimo.com/v1";

/** The Worker secret carrying the direct MiMo key. */
export const MIMO_KEY_VAR = "MIMO_API_KEY";

export const MIMO_MODEL_ID = "mimo-v2.5";

/** The model definition itself — public so a test can register it against a
 * scripted provider stream instead of the real endpoint. */
export function mimoModel(): Model<"openai-completions"> {
  return {
    id: MIMO_MODEL_ID,
    name: "MiMo v2.5",
    api: "openai-completions",
    provider: "mimo",
    baseUrl: MIMO_DIRECT_BASE_URL,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 32000,
  };
}

/** Resolves to exactly the key it was handed — never to an ambient credential. */
function fixedKeyAuth(apiKey: string) {
  return {
    apiKey: {
      name: MIMO_KEY_VAR,
      resolve: () => Promise.resolve({ auth: { apiKey }, source: MIMO_KEY_VAR }),
    },
  };
}

/** The registry one turn streams through, with mimo-v2.5 registered on it. */
export function createTurnModels(apiKey: string): MutableModels {
  const model = mimoModel();
  const models = createModels();
  models.setProvider(
    createProvider({
      id: model.provider,
      name: model.name,
      baseUrl: model.baseUrl,
      auth: fixedKeyAuth(apiKey),
      models: [model],
      api: { stream, streamSimple },
    }),
  );
  return models;
}

/** The turn's model, or a loud failure — never a silently model-less agent. */
function registeredMimo(models: MutableModels): Model<Api> {
  const model = models.getModel("mimo", MIMO_MODEL_ID);
  if (model === undefined) throw new Error(`${MIMO_MODEL_ID} is not registered`);
  return model;
}

/**
 * The per-request options every stream of this turn goes out with.
 *
 * pi accepts an injected fetch ONLY per request (`CreateProviderOptions` has no
 * `fetch` field), so a BYOK turn's egress guard has to be attached at each
 * call site. There are two of them — the agent loop (`turn-agent.ts`) and
 * `translate_anime_title`'s tool-less completion (`session-turn.ts`) — and a
 * second copy of this line is exactly how one of them would quietly stop being
 * guarded. A turn with no injected fetch passes its options through untouched,
 * so the mimo path keeps the call shape W0-S1 measured.
 */
export function streamOptionsFor(
  turn: TurnModel, options: ModelsSimpleStreamOptions | undefined,
): ModelsSimpleStreamOptions | undefined {
  const { fetch } = turn;
  return fetch === undefined ? options : { ...options, fetch };
}

/** The server-key turn: mimo-v2.5, direct, on the runtime's own fetch. */
export function mimoTurnModel(apiKey: string): TurnModel {
  const registry = createTurnModels(apiKey);
  return { registry, model: registeredMimo(registry), callerKeyed: false };
}

/** The one host the direct MiMo endpoint answers on. Adding a second is a review. */
export const MIMO_HOST = "api.xiaomimimo.com";

/** Every family token collapsed onto that single host, so whichever one the hop
 * declares, `api.xiaomimimo.com` is the only destination that passes — the same
 * device `web-search-egress.ts` uses and for the same reason. */
const MIMO_HOSTS: Readonly<Record<ByokProvider, readonly string[]>> = {
  openai: [MIMO_HOST],
  anthropic: [MIMO_HOST],
  google: [MIMO_HOST],
};

/** The family token this hop declares; it cannot widen the destination. */
const MIMO_FAMILY: ByokProvider = "openai";

/** The server model's own allowlist — one host, and no caller-chosen provider. */
export const SERVER_MODEL_EGRESS_POLICY = new EgressPolicy(new ProviderAllowlist(MIMO_HOSTS));

/**
 * The server model as a CALLER-KEYED turn reaches it (D18, #1289).
 *
 * A plain turn's mimo call keeps the exact unguarded shape W0-S1 measured —
 * our own configured endpoint has nothing for a guard to decide. This one is
 * different for a reason that is about the TURN, not the destination: a
 * caller-keyed turn is already spending a caller's key at a caller-named host,
 * and the platform's own credential is being spent inside it. Pinning that hop
 * to one host and refusing every redirect off it costs one allowlist instance
 * and means a caller-keyed turn has no unguarded way out at all.
 *
 * `inner` exists so a test can answer without reaching MiMo; production passes
 * nothing and gets `globalThis.fetch` under the guard.
 */
export function guardedMimoTurnModel(apiKey: string, inner?: EgressFetch): TurnModel {
  const registry = createTurnModels(apiKey);
  const guard = new GuardedFetch({
    provider: MIMO_FAMILY,
    key: apiKey,
    policy: SERVER_MODEL_EGRESS_POLICY,
    inner,
  });
  return { registry, model: registeredMimo(registry), callerKeyed: false, fetch: guard.fetch };
}

/** The direct MiMo key from the Worker environment, or undefined when unbound. */
export function mimoKeyIn(env: Record<string, unknown>): string | undefined {
  const key = env[MIMO_KEY_VAR];
  return typeof key === "string" && key !== "" ? key : undefined;
}
