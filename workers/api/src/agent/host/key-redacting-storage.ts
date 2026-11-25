import type { Context } from "@earendil-works/pi-agent-core/harness/context";
import type { EntryScan, ListReadOptions, Storage, StorageBranchScan, UsageScan, Value, ValueList, Write } from "@earendil-works/pi-agent-core/harness/session";
import type { KeyLiterals } from "../egress/key-literals.ts";
import { FrameRedaction } from "./frame-redaction.ts";
import { redactEntry, redactValue } from "./stored-record-redaction.ts";

/**
 * The store the session harness commits through: what reaches the database never holds a bound BYOK key, and what pi
 * reads back from it holds the redacted text. The keys are read at every commit, so a key is redacted from its binding
 * at admission until settlement releases it. Without a bound key, the writes are stored as committed.
 */
export class KeyRedactingStorage implements Storage {
  readonly #storage: Storage;
  readonly #literals: () => KeyLiterals;
  readonly #frames = new FrameRedaction();

  constructor(storage: Storage, literals: () => KeyLiterals) {
    this.#storage = storage;
    this.#literals = literals;
  }

  commit(writes: Write[], context: Context) {
    const literals = this.#literals();
    return this.#storage.commit(literals.isEmpty ? writes : writes.map((write) => this.#redact(write, literals)), context);
  }

  #redact(write: Write, literals: KeyLiterals): Write {
    if (write.kind === "entry") return { ...write, entry: redactEntry(write.entry, literals) };
    if (write.kind === "list") return this.#frames.list(write, literals);
    return write.kind === "value" && write.op === "set" ? { ...write, value: redactValue(write.namespace, write.value, literals) } : write;
  }

  getEntries(ids: string[], context: Context) { return this.#storage.getEntries(ids, context); }
  getValue<T>(address: Value<T>, context: Context) { return this.#storage.getValue(address, context); }
  scanValues<T>(prefix: Value<T>, context: Context) { return this.#storage.scanValues(prefix, context); }
  readList<T>(address: ValueList<T>, options: ListReadOptions | undefined, context: Context) { return this.#storage.readList(address, options, context); }
  scanBranch(query: StorageBranchScan, context: Context) { return this.#storage.scanBranch(query, context); }
  scanBranchStructure(query: StorageBranchScan, context: Context) { return this.#storage.scanBranchStructure(query, context); }
  scanEntries(query: EntryScan, context: Context) { return this.#storage.scanEntries(query, context); }
  scanUsage(query: UsageScan, context: Context) { return this.#storage.scanUsage(query, context); }
  getStats(context: Context) { return this.#storage.getStats(context); }
  close(context: Context) { return this.#storage.close(context); }
}
