import { branchTip, createForkSnapshot, projectForkCurrentStateWrite, validateCommittedWrites,
  type CommitValidationState, type CommittedListAppendWrite, type CommittedWrite, type ForkCurrentStatePlan,
  type ForkOptions, type SessionMetadata } from "@earendil-works/pi-agent-core/harness/session";
import type { JsonValue } from "@prisma/orm-postgres/target/codec-types";
import type { SessionDatabase } from "./database.ts";
import { persistWrite } from "./commit.ts";
import { scanEntries } from "./entries.ts";
import { readMetadata } from "./session-metadata.ts";
import { readAllListValues, readAllValues, type StoredListValue } from "./values.ts";

type ForkSnapshot = ReturnType<typeof createForkSnapshot> & { listWrites: CommittedListAppendWrite[] };

export async function readForkSnapshot(db: SessionDatabase, sessionId: string, options: ForkOptions): Promise<ForkSnapshot> {
  return db.transaction(async (tx) => {
    await tx.execute(db.raw.sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`.affectedCount().build());
    await readMetadata(tx, sessionId);
    const entries = await scanEntries(db, sessionId, { order: "asc" }, tx);
    const scalarValues = await readAllValues(tx, sessionId);
    const listValues = await readAllListValues(tx, sessionId);
    return extendWithListWrites(createForkSnapshot({ entries, scalarValues, entriesComplete: true }, options), options, listValues);
  });
}

function extendWithListWrites(snapshot: ReturnType<typeof createForkSnapshot>, options: ForkOptions, listValues: StoredListValue[]): ForkSnapshot {
  const listWrites = carryListWrites(snapshot, options, listValues);
  const nextSeq = Math.max(snapshot.nextSeq, ...listWrites.map((write) => write.seq + 1));
  return { ...snapshot, listWrites, nextSeq };
}

function carryListWrites(snapshot: ReturnType<typeof createForkSnapshot>, options: ForkOptions, listValues: StoredListValue[]): CommittedListAppendWrite[] {
  const plan = forkPlan(snapshot, options);
  const isEntryCopied = (entryId: string) => snapshot.entries.has(entryId);
  return listValues.flatMap((stored) => {
    const write: CommittedListAppendWrite = { ...stored.address, op: "append", seq: stored.seq, value: stored.value };
    const projected = projectForkCurrentStateWrite(write, plan, isEntryCopied);
    return projected?.kind === "list" ? [projected] : [];
  });
}

function forkPlan(snapshot: ReturnType<typeof createForkSnapshot>, options: ForkOptions): ForkCurrentStatePlan {
  if (options.scope === "tree") return { scope: "tree" };
  const namespace = branchTip("").namespace;
  const tip = snapshot.scalarValues.find((stored) => stored.address.namespace === namespace && stored.address.key === options.branch);
  return { scope: "branch", branch: options.branch, destinationTip: (tip?.value ?? null) as string | null };
}

function forkWrites(snapshot: ForkSnapshot): CommittedWrite[] {
  const entries: CommittedWrite[] = [...snapshot.entries.values()].map((entry) => ({ kind: "entry", ...entry }));
  const values: CommittedWrite[] = snapshot.scalarValues.map((stored) => ({ ...stored.address, op: "set", seq: stored.seq, value: stored.value }));
  return [...entries, ...values, ...snapshot.listWrites];
}

function validateForkWrites(writes: CommittedWrite[], state: CommitValidationState): void {
  validateCommittedWrites(writes.filter((write) => write.kind === "list").sort((left, right) => left.seq - right.seq), 0, state);
  validateCommittedWrites(writes.filter((write) => write.kind !== "list").sort((left, right) => left.seq - right.seq), 0, state);
}

export async function persistFork(db: SessionDatabase, metadata: SessionMetadata, snapshot: ForkSnapshot): Promise<void> {
  const writes = forkWrites(snapshot);
  validateForkWrites(writes, { hasEntryId: () => false, hasEntryOrUsageId: () => false });
  await db.transaction(async (tx) => {
    await tx.orm.public.PiSession.create({ id: metadata.id, metadata: metadata as unknown as JsonValue, nextSeq: snapshot.nextSeq });
    for (const write of writes) await persistWrite(tx, metadata.id, write);
  });
}
