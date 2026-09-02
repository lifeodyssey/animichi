// W0-S4 spike (#1247): the retrieval surface of spec §三 ("取回面"), spike-sized.
//
// This is what the client that hung up comes back to. The run, its steps and the
// transcript all come from Neon — the single source of truth — and the two
// numbers that can only come from this Durable Object (how many times the tool
// really executed, and the wall-clock the alarm was active for) ride along, so
// the measurement script can read the billing figure spec §七 asks for.

import type { JournalStorage } from "./run-journal.ts";
import { RunJournal } from "./run-journal.ts";
import type { PersistedStep, RunReport, RunStore, TranscriptEntry } from "./run-store.ts";
import { jsonError, noDatabase } from "./turn-intake.ts";

export interface RunStatusPayload {
  run: RunReport;
  steps: PersistedStep[];
  transcript: TranscriptEntry[];
  toolCalls: number;
  billedMs: number;
}

export class RunStatusView {
  private readonly store: RunStore | null;
  private readonly journal: RunJournal;

  constructor(store: RunStore | null, storage: JournalStorage) {
    this.store = store;
    this.journal = new RunJournal(storage);
  }

  async report(runId: string): Promise<Response> {
    if (this.store === null) return noDatabase();
    const run = await this.store.readRun(runId);
    if (run === null) return jsonError("no such run", 404);
    return Response.json(await this.payloadFor(this.store, run, runId));
  }

  private async payloadFor(store: RunStore, run: RunReport, runId: string): Promise<RunStatusPayload> {
    return {
      run,
      steps: await store.loadSteps(runId),
      transcript: await store.readTranscript(run.sessionId),
      toolCalls: await this.journal.toolCalls(runId),
      billedMs: await this.journal.billedMs(runId),
    };
  }
}
