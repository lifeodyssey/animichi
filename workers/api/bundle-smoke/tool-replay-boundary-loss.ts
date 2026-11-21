import type { Context } from "@earendil-works/pi-agent-core/harness/context";
import { MemorySessionRepo, operationToolArgsPrefix, pendingEntry, type CommitResult, type Session, type SessionMetadata, type SessionMutationCallback, type Write } from "@earendil-works/pi-agent-core/harness/session";

/**
 * The one commit the replay proof buys and loses. `Boundary` names the durable write the loss
 * targets, `BoundaryLossRepo` performs it, and the predicates below are how the loss takes aim: they
 * decide which writes belong to which boundary, so the repository drops that commit and no other.
 */
export type Boundary = "intent" | "effect" | "outcome" | "never";

/** The operation whose tool-argument write is the `intent` boundary. */
export const OPERATION = "replay";

/** What the one interrupted commit carried, and whether the repository accepted it before the loss. */
export interface InterruptedCommit {
  readonly committed: boolean;
  readonly toolResults: number;
  readonly staged: number;
  readonly args: number;
}

/** The real commit runs; the boundary decides whether it landed and whether its response survives. */
export class BoundaryLossRepo extends MemorySessionRepo {
  readonly boundary: Boundary;
  interrupted: InterruptedCommit = { committed: false, toolResults: 0, staged: 0, args: 0 };
  #armed = false;
  #spent = false;

  constructor(boundary: Boundary) {
    super({ now: () => 0 });
    this.boundary = boundary;
  }

  override async open(metadata: SessionMetadata, context: Context) {
    const session = await super.open(metadata, context);
    this.#armed = !this.#spent;
    interceptCommit(session, (writes, commit) => this.#settle(writes, commit));
    return session;
  }

  /** Exactly one commit is bought per run; every later attachment replays whatever survived it. */
  #settle(writes: readonly Write[], commit: () => Promise<CommitResult>) {
    if (!this.#armed || !targetsBoundary(writes, this.boundary)) return commit();
    this.#armed = false;
    this.#spent = true;
    this.interrupted = { ...describe(writes), committed: false };
    if (this.boundary === "effect" || this.boundary === "never") return Promise.reject(new Error("Injected failed outcome commit"));
    return commit().then(() => { this.interrupted = { ...describe(writes), committed: true }; throw new Error(`Injected lost ${this.boundary} commit response`); });
  }
}

function describe(writes: readonly Write[]): Omit<InterruptedCommit, "committed"> {
  return { toolResults: writes.filter(isToolResultEntry).length, staged: writes.filter(isValueSet(pendingEntry("").namespace)).length,
    args: writes.filter(isValueSet(operationToolArgsPrefix(OPERATION).namespace)).length };
}

function isToolResultEntry(write: Write) {
  return write.kind === "entry" && write.entry.type === "message" && write.entry.message.role === "toolResult";
}

/** Only one commit may be lost, and only the one whose writes name the boundary. */
function interceptCommit(session: Session, settle: (writes: readonly Write[], commit: () => Promise<CommitResult>) => Promise<CommitResult>) {
  const mutate = session.mutate.bind(session);
  session.mutate = <T>(work: SessionMutationCallback<T>, context: Context) => mutate((mutator, inside) => {
    const commit = mutator.commit.bind(mutator);
    mutator.commit = (writes: Write[], current: Context) => settle(writes, () => commit(writes, current));
    return work(mutator, inside);
  }, context);
}

function targetsBoundary(writes: readonly Write[], boundary: Boundary) {
  if (boundary === "intent") return writes.some(isValueSet(operationToolArgsPrefix(OPERATION).namespace));
  if (boundary === "outcome") return writes.some(isToolResultEntry);
  return writes.some(isValueSet(pendingEntry("").namespace));
}

function isValueSet(namespace: string) {
  return (write: Write) => write.kind === "value" && write.op === "set" && write.namespace === namespace;
}
