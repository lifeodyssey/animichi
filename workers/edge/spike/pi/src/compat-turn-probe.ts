// W0-S2 spike (#1245): runs one turn under one compat switch set and times it.
//
// It talks to pi through `TurnAgentView` (the same seam S1 introduced) rather
// than the concrete `Agent`, so the measurement logic can be driven over a
// provider double under node:test and never needs a Cloudflare binding.
//
// A provider that rejects the dialect does NOT reject `prompt()`: pi catches
// the adapter's throw and records it on `state.errorMessage`
// (pi-agent-core `dist/agent.js:342-359` — `runWithLifecycle` swallows every
// executor error into `handleRunFailure` and resolves). So the state is the
// only source for a dialect rejection. The try/catch below is for the other
// kind of failure: `Agent.prompt` itself throws when the agent is already
// processing (`dist/agent.js:228`), and a measured row is more useful there
// than a 500.

import type { AgentEvent } from "@earendil-works/pi-agent-core";
import type { CompatCommand } from "./compat-command.ts";
import {
  measurementOf,
  type CompatMeasurement,
  type TurnObservation,
} from "./compat-measurement.ts";
import type { TurnAgentView } from "./pi-turn-run.ts";

/** The first content delta of the turn — pi's `message_update` carries it. */
function isFirstContentDelta(event: AgentEvent): boolean {
  return event.type === "message_update";
}

function isSuccessfulToolEnd(event: AgentEvent): boolean {
  return event.type === "tool_execution_end" && !event.isError;
}

function emptyObservation(): TurnObservation {
  return { events: [], firstTokenMs: null, toolCallSucceeded: false, wallMs: 0, thrown: null };
}

export class CompatTurnProbe {
  private readonly agent: TurnAgentView;
  private readonly command: CompatCommand;
  private readonly now: () => number;
  private readonly observed: TurnObservation = emptyObservation();
  private startedAt = 0;

  constructor(agent: TurnAgentView, command: CompatCommand, now: () => number) {
    this.agent = agent;
    this.command = command;
    this.now = now;
  }

  async measure(): Promise<CompatMeasurement> {
    this.startedAt = this.now();
    const unsubscribe = this.agent.subscribe((event) => {
      this.observe(event);
    });
    this.observed.thrown = await this.promptSafely();
    this.observed.wallMs = this.now() - this.startedAt;
    unsubscribe();
    return measurementOf(this.command, this.observed, this.agent.state);
  }

  private async promptSafely(): Promise<string | null> {
    try {
      await this.agent.prompt(this.command.prompt);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : "unknown error";
    }
  }

  private observe(event: AgentEvent): void {
    this.observed.events.push(event.type);
    if (this.observed.firstTokenMs === null && isFirstContentDelta(event)) {
      this.observed.firstTokenMs = this.now() - this.startedAt;
    }
    if (isSuccessfulToolEnd(event)) this.observed.toolCallSucceeded = true;
  }
}
