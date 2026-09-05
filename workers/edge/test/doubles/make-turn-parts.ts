/**
 * The collaborators one `DurableTurn` test drives (card #1252).
 *
 * The provider is the W0-S1 double (`pi-provider-double.ts`): it drives the
 * REAL pi agent loop, really emits a tool call and really waits for the tool
 * result before answering, so a turn assembled here exercises the same code
 * path the deployed one does — only the socket is scripted.
 */
import { createModels, createProvider } from "@earendil-works/pi-ai";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type, type Static } from "typebox";
import { mimoModel, type TurnModel } from "../../src/agent/session/turn-model.ts";
import { TurnAnswering } from "../../src/agent/session/turn-answer.ts";
import { TurnCatalogSession } from "../../src/agent/session/turn-catalog-session.ts";
import type { Toolbox, TurnTool } from "../../src/agent/session/turn-toolbox.ts";
import { NO_SUPPLEMENTAL_USAGE } from "../../src/agent/settlement/supplemental-usage.ts";
import type { TurnUsage } from "../../src/agent/settlement/turn-settlement.ts";
import type { TranscriptRow } from "../../src/agent/session/turn-store.ts";
import { makeToolCallingStreamFn } from "./pi-provider-double.ts";

const spotParameters = Type.Object({ title: Type.String() });

/** A tool that counts its own real executions — the idempotency instrument.
 * `onCall` is where a case makes the world change mid-step (another
 * incarnation stealing the lease, a clock crossing the deadline). */
export class CountingSpotLookup implements Toolbox {
  calls = 0;
  /** What this toolbox claims its tools spent off-run (#1292). A case that is
   * not about the meter leaves it at nothing, which is what a toolbox with no
   * tool-less model call inside it really spends. */
  offRunUsage: TurnUsage = NO_SUPPLEMENTAL_USAGE;
  readonly #onCall: () => Promise<void>;

  constructor(onCall: () => Promise<void> = () => Promise.resolve()) {
    this.#onCall = onCall;
  }

  tools(): TurnTool[] {
    return [this.#tool()];
  }

  spent(): TurnUsage {
    return this.offRunUsage;
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

const bangumiParameters = Type.Object({ bangumi_id: Type.Number() });

/**
 * A tool whose schema wants a NUMBER, so a model that sends the id as text has
 * its arguments settled into something else before `execute` sees them — pi's
 * `validateToolArguments` (clone, optional nulls dropped, `Value.Convert`).
 * It records what it was actually called with, so the divergence is measured
 * at the tool rather than asserted about the persisted row alone.
 */
export class CoercingBangumiLookup implements Toolbox {
  readonly executedWith: unknown[] = [];

  tools(): TurnTool[] {
    return [this.#tool()];
  }

  spent(): TurnUsage {
    return NO_SUPPLEMENTAL_USAGE;
  }

  #tool(): AgentTool<typeof bangumiParameters> {
    return {
      name: "search_bangumi",
      label: "Search a bangumi's points",
      description: "Return the published pilgrimage points of one bangumi id.",
      parameters: bangumiParameters,
      execute: (_id: string, params: Static<typeof bangumiParameters>) => this.#answer(params),
    };
  }

  async #answer(params: Static<typeof bangumiParameters>): Promise<AgentToolResult<{ rows: number }>> {
    this.executedWith.push(params);
    return await Promise.resolve({ content: [{ type: "text", text: "2 points." }], details: { rows: 2 } });
  }
}

/** A turn model that streams from a script instead of a socket. */
export function makeScriptedTurnModel(streamFn = makeToolCallingStreamFn()): TurnModel {
  const model = mimoModel();
  const registry = createModels();
  registry.setProvider(
    createProvider({
      id: model.provider,
      name: model.name,
      baseUrl: model.baseUrl,
      auth: { apiKey: { name: "TEST", resolve: () => Promise.resolve({ auth: { apiKey: "k" }, source: "TEST" }) } },
      models: [model],
      api: { stream: streamFn, streamSimple: streamFn },
    }),
  );
  return { registry, model, callerKeyed: false };
}

/**
 * The turn parts one `TurnCatalogSession` fulfils: how the turn ANSWERS
 * (#1283, the `respond` tool over the session's stored results), what it
 * REMEMBERS (#1290, the fact ledger and the retained entities), what its
 * `<agent_status>` bar reads (#1379, the live envelope) and the refs it
 * MINTED (#1279, put back from the settled steps on a retry) — plus the
 * DETERMINISTIC selection seam (#1288), which every case here leaves null
 * because these are model turns; the selection cases build their own turn
 * (`make-selection-turn.ts`).
 *
 * They are built together because production builds them together —
 * `session-turn.ts` hands the same session to both — and a double that gave a
 * turn two different sessions would be a shape the deployed turn never has.
 */
export function makeSessionTurnParts(
  session: TurnCatalogSession = new TurnCatalogSession({ runId: "run-1", locale: "ja" }),
): {
  answering: TurnAnswering;
  memory: TurnCatalogSession;
  session: TurnCatalogSession;
  refs: TurnCatalogSession;
  selection: null;
} {
  return { answering: new TurnAnswering(session), memory: session, session, refs: session, selection: null };
}

/** The one user message every case starts from. */
export function makeUserTranscript(text = "Hyouka の聖地は？"): TranscriptRow[] {
  return [{ role: "user", content: text, responseData: null }];
}
