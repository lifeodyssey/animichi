// W0-S1 spike (#1244): drives one pi turn, mirrors its events to a sink, and
// fires the requested abort at the break point it names.
//
// It talks to pi through `TurnAgentView` rather than the concrete `Agent`
// class so the abort-point tests can drive the real agent loop over a scripted
// provider stream, and so this file never needs a Cloudflare binding.

import type { AgentEvent } from "@earendil-works/pi-agent-core";
import { reachedAbortPoint } from "./abort-point-trigger.ts";
import type { TurnCommand } from "./turn-command.ts";
import {
  assistantTextOf,
  danglingStateOf,
  hasDanglingState,
  type TurnOutcome,
  type TurnStateView,
} from "./turn-outcome.ts";

export interface TurnFrame {
  event: string;
  data: Record<string, string | boolean>;
}

export type TurnFrameSink = (frame: TurnFrame) => Promise<void> | void;

export interface TurnAgentView {
  subscribe(listener: (event: AgentEvent) => Promise<void> | void): () => void;
  prompt(input: string): Promise<void>;
  abort(): void;
  readonly state: TurnStateView;
}

/** Only the fields the SSE consumer needs — never a raw message payload. */
export function frameDataOf(event: AgentEvent): Record<string, string | boolean> {
  if (event.type === "tool_execution_start") return { toolName: event.toolName };
  if (event.type === "tool_execution_end") {
    return { toolName: event.toolName, isError: event.isError };
  }
  return {};
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

export class PiTurnRun {
  private readonly eventTypes: string[] = [];
  private abortFired = false;
  private readonly agent: TurnAgentView;
  private readonly command: TurnCommand;
  private readonly sink: TurnFrameSink;
  private readonly now: () => number;

  constructor(agent: TurnAgentView, command: TurnCommand, sink: TurnFrameSink, now: () => number) {
    this.agent = agent;
    this.command = command;
    this.sink = sink;
    this.now = now;
  }

  async execute(runId: string): Promise<TurnOutcome> {
    const startedAt = this.now();
    const unsubscribe = this.agent.subscribe((event) => this.observe(event));
    const failure = await this.promptSafely();
    unsubscribe();
    return this.outcomeOf(runId, this.now() - startedAt, failure);
  }

  private async promptSafely(): Promise<string | null> {
    try {
      await this.agent.prompt(this.command.prompt);
      return null;
    } catch (error) {
      return messageOf(error);
    }
  }

  private async observe(event: AgentEvent): Promise<void> {
    this.eventTypes.push(event.type);
    await this.sink({ event: event.type, data: frameDataOf(event) });
    this.abortIfAtBreakPoint(event);
  }

  private abortIfAtBreakPoint(event: AgentEvent): void {
    const point = this.command.abortPoint;
    if (this.abortFired || point === null) return;
    if (!reachedAbortPoint(point, event)) return;
    this.abortFired = true;
    this.agent.abort();
  }

  private outcomeOf(runId: string, durationMs: number, error: string | null): TurnOutcome {
    const dangling = danglingStateOf(this.agent.state);
    return {
      runId,
      provider: this.command.provider,
      abortPoint: this.command.abortPoint,
      abortFired: this.abortFired,
      events: [...this.eventTypes],
      messageCount: this.agent.state.messages.length,
      text: assistantTextOf(this.agent.state.messages),
      durationMs,
      dangling,
      clean: !hasDanglingState(dangling),
      error,
    };
  }
}
