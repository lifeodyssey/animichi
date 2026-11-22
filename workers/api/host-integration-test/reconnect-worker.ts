import type { TestContext } from "node:test";
import { Miniflare } from "miniflare";
import { bundledEntries } from "../bundle-smoke/bundled-entries.ts";
import { deployedRuntime } from "../bundle-smoke/wrangler-bundle.ts";
import { dsn, IDENTITY } from "./postgres.ts";

/** Only the external model transport pauses; gateway, admission, watch and drive are production code. */
export async function reconnectWorker(context: TestContext) {
  const entered = Promise.withResolvers<undefined>();
  const released = Promise.withResolvers<undefined>();
  const requests: Request[] = [];
  const resources: { worker?: Miniflare } = {};
  context.after(async () => { released.resolve(undefined); await resources.worker?.dispose(); });
  const bundle = await bundledEntries.modules(new URL("./default-host.worker.ts", import.meta.url).pathname);
  const worker = resources.worker = new Miniflare({ ...bundle, ...deployedRuntime(),
    bindings: { AGENT_SVC_DATABASE_URL: dsn, MIMO_API_KEY: "server-private-key", ANON_DAILY_MESSAGE_QUOTA: "2",
      TEST_IDENTITY: IDENTITY, TEST_USER_TYPE: "anonymous" },
    durableObjects: { AGENT_SESSION: { className: "AgentSession", useSQLite: true } },
    serviceBindings: { CATALOG: () => Promise.reject(new Error("This greeting must not call the catalog")) },
    outboundService: async (request: Request) => {
      requests.push(request.clone()); entered.resolve(undefined);
      await released.promise;
      return completion();
    } });
  await worker.ready;
  return { worker, entered: entered.promise, release: () => { released.resolve(undefined); }, requests };
}

function completion() {
  const delta = { tool_calls: [{ index: 0, id: "answer", type: "function", function: {
    name: "respond", arguments: JSON.stringify({ kind: "greeting", message: "Reconnected to the same native turn" }),
  } }] };
  const chunk = { id: "native", object: "chat.completion.chunk", created: 0, model: "mimo-v2.5",
    choices: [{ index: 0, delta, finish_reason: "tool_calls" }], usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 } };
  return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
}
