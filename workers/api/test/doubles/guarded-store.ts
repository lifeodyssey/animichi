import assert from "node:assert/strict";
import { AgentHarness, type AgentHarnessTool } from "@earendil-works/pi-agent-core";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { MemorySessionRepo, StorageBackedSession, type ListAppendWrite, type Session, type SessionMetadata, type Storage, type Write } from "@earendil-works/pi-agent-core/harness/session";
import { InstrumentedStorage, StorageDecorator } from "@earendil-works/pi-agent-core/harness/session/testing";
import { createModels, fauxProvider, reduceAssistantMessageFrames, type AssistantMessageFrame, type FauxResponseStep } from "@earendil-works/pi-ai";
import { KeyLiterals } from "../../src/agent/egress/key-literals.ts";
import { KeyRedactingStorage } from "../../src/agent/host/key-redacting-storage.ts";

const FRAMES = "pi.pending.assistant_frame";

function isStorage(value: unknown): value is Storage {
  return typeof value === "object" && value !== null && "commit" in value && "scanBranch" in value;
}

/** Memory that outlives each session's handle, as a database outlives a connection: closing a session keeps its records. */
class DatabaseMemory extends StorageDecorator {
  override close() { return Promise.resolve(); }
}

/** pi publishes no constructible in-memory Storage; a MemorySessionRepo session's facade wraps a session holding one. */
async function memoryStorage() {
  const created = await new MemorySessionRepo({ now: () => 0 }).create({}, BACKGROUND_CONTEXT);
  const backing: unknown = Reflect.get(created, "session");
  const storage: unknown = typeof backing === "object" && backing !== null ? Reflect.get(backing, "storage") : undefined;
  assert.ok(isStorage(storage), "pi's memory session facade wraps a StorageBackedSession that keeps its Storage");
  return { storage: new InstrumentedStorage(new DatabaseMemory(storage)), metadata: created.metadata };
}

/** The in-memory store behind the KeyRedactingStorage under test; `received` records what reached the store. */
export interface GuardedStore { readonly received: InstrumentedStorage; readonly metadata: SessionMetadata }

/** A session over `store` as a host opens it: a fresh KeyRedactingStorage holding `secrets`, recorded from above. */
export function guardedSession(store: GuardedStore, secrets: readonly string[]) {
  const committed = new InstrumentedStorage(new KeyRedactingStorage(store.received, () => new KeyLiterals(secrets)));
  return { committed, session: new StorageBackedSession(store.metadata, committed) };
}

/** A new store and its first guarded session. */
export async function guardedStore(secrets: readonly string[]) {
  const { storage, metadata } = await memoryStorage();
  const store = { received: storage, metadata };
  return { store, ...guardedSession(store, secrets) };
}

/** A real harness over `session` whose faux model streams every block in four-character chunks. */
export async function chunkedHarness(session: Session, responses: FauxResponseStep[], tools: AgentHarnessTool<object>[] = []) {
  const provider = fauxProvider({ tokenSize: { min: 1, max: 1 } });
  provider.setResponses(responses);
  const models = createModels();
  models.setProvider(provider.provider);
  const { harness } = await AgentHarness.create({ session, tools, toolContext: {}, models, model: provider.getModel(),
    retry: { enabled: true, maxRetries: 1, baseDelayMs: 0 } }, BACKGROUND_CONTEXT);
  return harness;
}

/** One prompt through a fresh chunked harness, driven to its end; the harness is closed before this returns. */
export async function promptThrough(session: Session, prompt: string, responses: FauxResponseStep[], tools: AgentHarnessTool<object>[] = []) {
  const harness = await chunkedHarness(session, responses, tools);
  try { return await (await harness.lane("main", BACKGROUND_CONTEXT)).prompt(prompt, undefined, BACKGROUND_CONTEXT); }
  finally { await harness.close(BACKGROUND_CONTEXT); }
}

/** A streamed answer's frame, one per chunk, as pi appends it while the answer streams. */
export function isFrameAppend(write: Write): write is ListAppendWrite {
  return write.kind === "list" && write.op === "append" && write.namespace === FRAMES;
}

/** Each streamed answer's frames replayed; `interrupted` stops every block short of its end, as a recovery replays it. */
export function replayedStreams(writes: readonly Write[], interrupted: boolean) {
  const streams = new Map<string, AssistantMessageFrame[]>();
  for (const write of writes.filter(isFrameAppend)) streams.set(write.key, [...streams.get(write.key) ?? [], write.value as AssistantMessageFrame]);
  return [...streams.values()].map((frames) => reduceAssistantMessageFrames(frames.filter((frame) => !interrupted || !frame.type.endsWith("_end"))));
}

/** Every write the store received, and every interrupted stream, as one JSON string. */
export function storedRecords(store: GuardedStore): string {
  const writes = store.received.getCommitAttempts().flat();
  return JSON.stringify({ writes, interrupted: replayedStreams(writes, true) });
}

/** How a key reads inside that JSON: as a string field, and as JSON text held in a string field. */
export function storedForms(key: string): string[] {
  const field = JSON.stringify(key).slice(1, -1);
  return [field, JSON.stringify(field).slice(1, -1)];
}
