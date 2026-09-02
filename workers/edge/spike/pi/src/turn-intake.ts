// W0-S4 spike (#1247): the intake of spec §三, spike-sized.
//
// `fetch` does three things and then gets out of the way: it writes the turn
// down in Neon (session + user message + `runs(running)`, where the INSERT *is*
// the admission decision), it registers an in-memory SSE subscriber, and it arms
// `setAlarm(now)`. It never runs the turn — that is the binding decision of spec
// §二, and it is why hanging up on this response cannot stop anything.

import { parseLongTurnCommand } from "./long-turn-command.ts";
import type { JournalStorage, PendingTurn, RunJournal } from "./run-journal.ts";
import type { RunStore, TurnIdentity } from "./run-store.ts";
import { sseResponse } from "./sse-turn-channel.ts";
import type { TurnSubscribers } from "./turn-subscribers.ts";

/** The prompt the spike's long turn stores; it never reaches a model. */
const TURN_PROMPT = "Take the long way round: look the spot up three times.";

export interface AlarmArm {
  setAlarm(when: number): Promise<void>;
}

export function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

export function noDatabase(): Response {
  return jsonError("SPIKE_DATABASE_URL is not configured", 503);
}

async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function newTurnIdentity(sessionId: string): TurnIdentity {
  return {
    runId: crypto.randomUUID(),
    sessionId,
    userMessageId: crypto.randomUUID(),
    assistantMessageId: crypto.randomUUID(),
  };
}

export interface TurnIntakeParts {
  store: RunStore | null;
  journal: RunJournal;
  subscribers: TurnSubscribers;
  storage: JournalStorage & AlarmArm;
  now: () => number;
}

export class TurnIntake {
  private readonly parts: TurnIntakeParts;

  constructor(parts: TurnIntakeParts) {
    this.parts = parts;
  }

  async open(request: Request, sessionId: string): Promise<Response> {
    const parsed = parseLongTurnCommand(await readJsonBody(request));
    if (!parsed.ok) return jsonError(parsed.error, 400);
    const { store } = this.parts;
    if (store === null) return noDatabase();
    const pending: PendingTurn = { identity: newTurnIdentity(sessionId), command: parsed.command };
    const deadlineAt = new Date(this.parts.now() + parsed.command.deadlineMs);
    const opened = await store.openTurn(pending.identity, TURN_PROMPT, deadlineAt);
    if (opened === "session_busy") return jsonError("session already has a running turn", 409);
    return await this.arm(pending);
  }

  private async arm(pending: PendingTurn): Promise<Response> {
    const { runId } = pending.identity;
    const channel = this.parts.subscribers.register(runId);
    await this.parts.journal.queue(pending);
    await this.parts.storage.setAlarm(this.parts.now());
    const response = sseResponse(channel.body);
    response.headers.set("x-spike-run-id", runId);
    return response;
  }
}
