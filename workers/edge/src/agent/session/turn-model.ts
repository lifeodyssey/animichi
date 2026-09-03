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
  type MutableModels,
} from "@earendil-works/pi-ai";
import { stream, streamSimple } from "@earendil-works/pi-ai/api/openai-completions";

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
export function turnModel(models: MutableModels): Model<Api> {
  const model = models.getModel("mimo", MIMO_MODEL_ID);
  if (model === undefined) throw new Error(`${MIMO_MODEL_ID} is not registered`);
  return model;
}

/** The direct MiMo key from the Worker environment, or undefined when unbound. */
export function mimoKeyIn(env: Record<string, unknown>): string | undefined {
  const key = env[MIMO_KEY_VAR];
  return typeof key === "string" && key !== "" ? key : undefined;
}
