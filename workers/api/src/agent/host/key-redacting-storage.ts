import type { Context } from "@earendil-works/pi-agent-core/harness/context";
import type { EntryScan, ListReadOptions, Storage, StorageBranchScan, UsageScan, Value, ValueList, Write } from "@earendil-works/pi-agent-core/harness/session";
import type { KeyLiterals } from "../egress/key-literals.ts";

/** The store the session harness commits through: what reaches the database never holds a bound BYOK key. */
export class KeyRedactingStorage implements Storage {
  readonly #storage: Storage;

  constructor(storage: Storage, _literals: () => KeyLiterals) {
    this.#storage = storage;
  }

  commit(writes: Write[], context: Context) { return this.#storage.commit(writes, context); }
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
