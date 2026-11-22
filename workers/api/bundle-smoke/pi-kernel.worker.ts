/**
 * Bundled-artifact smoke entrypoint for the pi agent kernel (W0-S3, issue #1246).
 *
 * WHY THIS FILE EXISTS — the bug it pins down
 * Full report, written to be filed upstream:
 * `docs/specs/2026-09-01-pi-ai-esbuild-lazy-chunk-report.md`. Importing
 * `@earendil-works/pi-ai/api/<id>.lazy` from a bundle entry makes esbuild emit
 * `models.js` as a lazy `__esm` chunk but omit the matching `init_models()`
 * call from entry scope, so the first `createModels()` throws
 * `TypeError: ModelsImpl is not a constructor`. Reproduced under standalone
 * esbuild and under wrangler's embedded esbuild; running the npm `dist` from
 * Node is fine, so it is purely a bundle-artifact defect. pi's own
 * `check:browser-smoke` builds without executing, which is exactly why nobody
 * upstream has seen it.
 *
 * THE WORKAROUND THIS FILE LANDS
 * Import the EAGER `@earendil-works/pi-ai/api/openai-completions` module — never
 * the `.lazy` subpath. Eager pulls the OpenAI SDK into the bundle; in a Worker
 * that costs a few hundred KiB and buys a bundle that actually boots.
 *
 * HOW IT IS ENFORCED
 * `pi-kernel.test.ts` bundles this file the way wrangler bundles a Worker and
 * executes the artifact in workerd. Point the import below back at
 * `.../openai-completions.lazy` and that test goes red on the real runtime
 * error, not on a string match.
 */
import { createModels, createProvider } from "@earendil-works/pi-ai";
import type {
  AssistantMessage,
  AssistantMessageEvent,
  Model,
  UserMessage,
} from "@earendil-works/pi-ai";
// The workaround. Do not rewrite this to `openai-completions.lazy`.
import * as openaiCompletions from "@earendil-works/pi-ai/api/openai-completions";

const PROVIDER_ID = "bundle-smoke";

const SMOKE_MODEL: Model<"openai-completions"> = {
  id: "bundle-smoke-model",
  name: "bundle smoke model",
  api: "openai-completions",
  provider: PROVIDER_ID,
  baseUrl: "https://bundle-smoke.invalid/v1",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 4096,
  maxTokens: 256,
};

/** One OpenAI-completions SSE turn: a single "pong" delta, then stop. */
const SSE_TURN = [
  `data: {"id":"smoke","object":"chat.completion.chunk","created":1,"model":"${SMOKE_MODEL.id}","choices":[{"index":0,"delta":{"role":"assistant","content":"pong"},"finish_reason":null}]}`,
  `data: {"id":"smoke","object":"chat.completion.chunk","created":1,"model":"${SMOKE_MODEL.id}","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}`,
  "data: [DONE]",
  "",
].join("\n\n");

/** Provider transport double: the smoke never leaves workerd. */
function replayTurn(): Promise<Response> {
  return Promise.resolve(
    new Response(SSE_TURN, { status: 200, headers: { "content-type": "text/event-stream" } }),
  );
}

function smokeProvider() {
  return createProvider({
    id: PROVIDER_ID,
    api: openaiCompletions,
    models: [SMOKE_MODEL],
    auth: { apiKey: { name: "bundle smoke key", resolve: resolveSmokeKey } },
  });
}

function resolveSmokeKey(): Promise<{ auth: { apiKey: string } }> {
  return Promise.resolve({ auth: { apiKey: "bundle-smoke-key" } });
}

export interface SmokeTurnReport {
  events: AssistantMessageEvent["type"][];
  text: string;
  stopReason: string;
}

function userTurn(content: string): UserMessage {
  return { role: "user", content, timestamp: 0 };
}

/**
 * Register a custom provider, run one full turn through the pi model layer,
 * and report what came back. Every step here touches a module that the
 * chunk-init bug leaves uninitialised in the bundle.
 */
export async function runSmokeTurn(): Promise<SmokeTurnReport> {
  const models = createModels();
  models.setProvider(smokeProvider());
  const model = models.getModel(PROVIDER_ID, SMOKE_MODEL.id);
  if (!model) throw new Error("bundle smoke: provider did not register its model");
  const stream = models.stream(model, { messages: [userTurn("ping")] }, { fetch: replayTurn });
  const events: AssistantMessageEvent["type"][] = [];
  for await (const event of stream) events.push(event.type);
  return { events, ...assistantReply(await stream.result()) };
}

function assistantReply(message: AssistantMessage): Omit<SmokeTurnReport, "events"> {
  const text = message.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("");
  return { text, stopReason: message.stopReason };
}

export default {
  async fetch(): Promise<Response> {
    return Response.json(await runSmokeTurn());
  },
};
