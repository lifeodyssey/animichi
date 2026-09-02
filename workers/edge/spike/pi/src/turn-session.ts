// W0-S1 spike (#1244): the Durable Object that hosts a pi turn.
//
// The binding decision from the spec (§二) is exercised literally here: the
// client's fetch only writes the run down, arms `setAlarm(now)` and hands back
// an SSE body. The turn itself runs inside `alarm()`, which owns its own
// 15-minute wall clock and does not depend on the caller staying connected.

import { Agent } from "@earendil-works/pi-agent-core";
import { PiTurnRun, type TurnAgentView } from "./pi-turn-run.ts";
import { SseTurnChannel, sseResponse } from "./sse-turn-channel.ts";
import {
  configuredProviders,
  createSpikeModels,
  modelFor,
  type ProviderKeys,
} from "./spike-models.ts";
import { abortRequiredFor, routeOf } from "./spike-routes.ts";
import { createSpotLookupTool } from "./spot-lookup-tool.ts";
import { parseTurnCommand, type TurnCommand } from "./turn-command.ts";
import type { TurnOutcome } from "./turn-outcome.ts";

const SYSTEM_PROMPT =
  "You are an anime pilgrimage assistant. Always call the lookup_spot tool before answering.";
// Long enough that an abort armed on `tool_execution_start` lands while the
// tool is still executing, short enough that an un-aborted turn is not slowed.
const TOOL_HOLD_MS = 1500;

interface QueuedTurn {
  runId: string;
  command: TurnCommand;
  channel: SseTurnChannel;
}

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export class PiTurnSession {
  private readonly queue: QueuedTurn[] = [];
  private readonly ctx: DurableObjectState;
  private readonly env: ProviderKeys;

  constructor(ctx: DurableObjectState, env: ProviderKeys) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const route = routeOf(request.method, new URL(request.url).pathname);
    const parsed = parseTurnCommand(await readJsonBody(request), abortRequiredFor(route));
    if (!parsed.ok) return jsonError(parsed.error, 400);
    if (!configuredProviders(this.env)[parsed.command.provider]) {
      return jsonError(`provider ${parsed.command.provider} has no key configured`, 503);
    }
    return await this.schedule(parsed.command);
  }

  async alarm(): Promise<void> {
    const pending = this.queue.splice(0, this.queue.length);
    for (const queued of pending) await this.runQueued(queued);
    await this.recordRunsLostToEviction();
  }

  // An instance evicted between `setAlarm` and the alarm firing loses the
  // in-memory queue while its run row survives. Resuming such a run is S4's
  // question, not S1's; leaving a row that claims to be queued forever is not
  // acceptable either, so the sweep records the loss as measurable evidence.
  private async recordRunsLostToEviction(): Promise<void> {
    const live = new Set(this.queue.map((queued) => `run:${queued.runId}`));
    const rows = await this.ctx.storage.list<Record<string, unknown>>({ prefix: "run:" });
    for (const [key, row] of rows) {
      if (row.status !== "queued" || live.has(key)) continue;
      await this.ctx.storage.put(key, { ...row, status: "lost_to_eviction" });
    }
  }

  private async schedule(command: TurnCommand): Promise<Response> {
    const queued: QueuedTurn = {
      runId: crypto.randomUUID(),
      command,
      channel: new SseTurnChannel(),
    };
    this.queue.push(queued);
    await this.ctx.storage.put(`run:${queued.runId}`, { status: "queued", ...command });
    await this.ctx.storage.setAlarm(Date.now());
    return sseResponse(queued.channel.body);
  }

  // A throw inside the alarm must still close the SSE body, or the caller
  // waits on a stream nothing will ever finish.
  private async runQueued(queued: QueuedTurn): Promise<void> {
    try {
      await this.settle(queued, await this.runTurn(queued));
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      await queued.channel.send("failed", { message });
    }
    await queued.channel.close();
  }

  private async settle(queued: QueuedTurn, outcome: TurnOutcome): Promise<void> {
    await this.ctx.storage.put(`run:${queued.runId}`, { status: "settled", ...outcome });
    await queued.channel.send("outcome", {
      ...outcome,
      clientGone: queued.channel.clientGone,
      alarmScheduled: (await this.ctx.storage.getAlarm()) !== null,
    });
  }

  private async runTurn(queued: QueuedTurn): Promise<TurnOutcome> {
    const agent = this.agentFor(queued.command);
    if (agent === null) throw new Error(`provider ${queued.command.provider} is not configured`);
    const sink = (frame: { event: string; data: Record<string, string | boolean> }) =>
      queued.channel.send(frame.event, frame.data);
    const run = new PiTurnRun(agent, queued.command, sink, () => Date.now());
    return await run.execute(queued.runId);
  }

  private agentFor(command: TurnCommand): TurnAgentView | null {
    const models = createSpikeModels(this.env);
    const model = modelFor(models, command.provider);
    if (model === undefined) return null;
    return new Agent({
      initialState: { systemPrompt: SYSTEM_PROMPT, model, tools: [createSpotLookupTool(TOOL_HOLD_MS)] },
      streamFn: (target, context, options) => models.streamSimple(target, context, options),
    });
  }
}
