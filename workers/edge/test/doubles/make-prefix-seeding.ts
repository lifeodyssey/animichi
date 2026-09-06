/**
 * The collaborators one prefix seeding drives (E-1 #1380), as a case can read
 * them back.
 *
 * The two WRITE seams are the production doubles already in this folder —
 * `InMemoryTurnStore`, which keeps the DDL's invariants, and
 * `RecordingEnvelopeStorage` behind the real `DurableEnvelopeStore` — so a
 * seeded prefix is judged against the same rules a lived turn is. Only the two
 * READS are scripted here, because they are what a case is about: whose session
 * it is, and whether this case has already seeded it.
 */
import { DurableEnvelopeStore } from "../../src/agent/session/durable-envelope-store.ts";
import type {
  PrefixSeedingParts,
  SeededSessionRecords,
} from "../../src/agent/session/prefix-seeding.ts";
import type { ConversationFacts } from "../../src/agent/retrieval/conversation-retrieval.ts";
import type { IntakeReceipt, OpenedTurn, TurnRecords } from "../../src/agent/intake/turn-intake.ts";
import { InMemoryTurnStore } from "./in-memory-turn-store.ts";
import { RecordingEnvelopeStorage } from "./recording-envelope-storage.ts";
import { SEEDING_IDENTITY } from "./make-trajectory-prefix.ts";

/** The run id the intake double hands the seeding. */
export const SEEDED_RUN_ID = "run-prefix-1";

/** The Durable Object incarnation the seeding takes the lease as. */
export const SEEDING_OWNER = "do-incarnation-1";

const NOW = Date.UTC(2026, 8, 6, 9, 0, 0);

/** What a case scripts: the session as the reads find it, and whether the
 * intake answers a replay. */
export interface PrefixSeedingScript {
  readonly facts?: ConversationFacts | null;
  readonly carriesPrefix?: boolean;
  readonly replayed?: boolean;
  readonly sessionId?: string;
}

/** A session owned by the seeding identity, with the turn count a case names. */
export function makeSessionFacts(turnCount: number, ownerId = SEEDING_IDENTITY): ConversationFacts {
  return { ownerId, turnCount, latestRun: null };
}

function scriptedRecords(script: PrefixSeedingScript): SeededSessionRecords {
  return {
    factsOf: () => Promise.resolve(script.facts ?? null),
    carriesPrefix: () => Promise.resolve(script.carriesPrefix ?? false),
  };
}

/** The intake, recording every turn it was asked to open. */
function recordingRecords(script: PrefixSeedingScript, opened: OpenedTurn[]): TurnRecords {
  return {
    openTurn(turn: OpenedTurn): Promise<IntakeReceipt> {
      opened.push(turn);
      const receipt = { messageId: "message-1", runId: SEEDED_RUN_ID, replayed: script.replayed ?? false };
      return Promise.resolve(receipt);
    },
  };
}

/** Everything a case reads after driving one seeding. */
export interface PrefixSeedingHarness {
  readonly parts: PrefixSeedingParts;
  readonly store: InMemoryTurnStore;
  readonly storage: RecordingEnvelopeStorage;
  /** Every `openTurn` the seeding made — empty means it wrote nothing at all. */
  readonly opened: OpenedTurn[];
}

export function makePrefixSeeding(script: PrefixSeedingScript = {}): PrefixSeedingHarness {
  const sessionId = script.sessionId ?? "session-prefix-1";
  const storage = new RecordingEnvelopeStorage();
  const opened: OpenedTurn[] = [];
  const store = new InMemoryTurnStore(
    { runId: SEEDED_RUN_ID, sessionId, deadlineAt: NOW + 100_000, transcript: [], steps: [] },
    () => NOW,
  );
  const parts: PrefixSeedingParts = {
    records: scriptedRecords(script),
    turns: recordingRecords(script, opened),
    store,
    envelopes: new DurableEnvelopeStore(storage),
    owner: SEEDING_OWNER,
    prices: { inputUsdPerMtok: 0, outputUsdPerMtok: 0 },
    now: () => NOW,
  };
  return { parts, store, storage, opened };
}
