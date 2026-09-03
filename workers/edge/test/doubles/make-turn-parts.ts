/**
 * The collaborators one `DurableTurn` test drives (card #1252).
 *
 * The provider is the W0-S1 double (`pi-provider-double.ts`): it drives the
 * REAL pi agent loop, really emits a tool call and really waits for the tool
 * result before answering, so a turn assembled here exercises the same code
 * path the deployed one does — only the socket is scripted.
 */
import { createModels, createProvider, type MutableModels } from "@earendil-works/pi-ai";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type, type Static } from "typebox";
import { mimoModel } from "../../src/agent/session/turn-model.ts";
import type { Toolbox, TurnTool } from "../../src/agent/session/turn-toolbox.ts";
import type { TranscriptRow } from "../../src/agent/session/turn-store.ts";
import { makeToolCallingStreamFn } from "./pi-provider-double.ts";

const spotParameters = Type.Object({ title: Type.String() });

/** A tool that counts its own real executions — the idempotency instrument.
 * `onCall` is where a case makes the world change mid-step (another
 * incarnation stealing the lease, a clock crossing the deadline). */
export class CountingSpotLookup implements Toolbox {
  calls = 0;
  readonly #onCall: () => Promise<void>;

  constructor(onCall: () => Promise<void> = () => Promise.resolve()) {
    this.#onCall = onCall;
  }

  tools(): TurnTool[] {
    return [this.#tool()];
  }

  #tool(): AgentTool<typeof spotParameters> {
    return {
      name: "lookup_spot",
      label: "Look up a pilgrimage spot",
      description: "Return the real-world pilgrimage location for an anime title.",
      parameters: spotParameters,
      execute: (_id: string, params: Static<typeof spotParameters>) => this.#answer(params.title),
    };
  }

  async #answer(title: string): Promise<AgentToolResult<{ title: string }>> {
    this.calls += 1;
    await this.#onCall();
    return { content: [{ type: "text", text: `Takayama, for ${title}.` }], details: { title } };
  }
}

/** A models registry that streams from a script instead of a socket. */
export function makeScriptedModels(streamFn = makeToolCallingStreamFn()): MutableModels {
  const model = mimoModel();
  const models = createModels();
  models.setProvider(
    createProvider({
      id: model.provider,
      name: model.name,
      baseUrl: model.baseUrl,
      auth: { apiKey: { name: "TEST", resolve: () => Promise.resolve({ auth: { apiKey: "k" }, source: "TEST" }) } },
      models: [model],
      api: { stream: streamFn, streamSimple: streamFn },
    }),
  );
  return models;
}

/** The one user message every case starts from. */
export function makeUserTranscript(text = "Hyouka の聖地は？"): TranscriptRow[] {
  return [{ role: "user", content: text, responseData: null }];
}
