/**
 * A minimal Postgres backend for pi-durable 1.5.2's `Storage`, keyed by the outer `SessionAgent`'s session id: every
 * row carries `session_key`, so two objects whose root conversation is `1` never share a keyspace. A port of
 * `SqliteStorage` (`@earendil-works/pi-durable@1.5.2 dist/storage/sqlite/storage.js`), query for query, over `pg`:
 * - one connection per open storage, every call serialised on it, so no read runs inside an open commit transaction;
 * - a commit is `BEGIN`, one state read (the keyspace's metadata row locked `FOR UPDATE`, which also serialises a
 *   second process on the same key), the checks in memory, one write statement, `COMMIT` (`commit.ts`);
 * - ids are minted in memory from `next_id`, persisted with each commit, as `SqliteStorage` does.
 * It runs unchanged in Node (b1) and in workerd, where `pg` connects through `cloudflare:sockets`.
 */
import { apply, type Op } from "@earendil-works/chord/delta";
import type { Context } from "@earendil-works/chord/context";
import { StorageRequestError, type CommitResult, type ConversationId, type ConversationQuery, type ConversationRecord, type Cursor, type DocumentAddress,
  type DocumentId, type DocumentPoint, type DocumentQuery, type DocumentRecord, type EntryId, type EntryQuery, type EntryRecord, type Id, type Page,
  type Seq, type Storage, type StorageWrite, type StoredDocument, type SubmissionId, type SubmissionQuery, type SubmissionRecord, type TaskId,
  type TaskQuery, type TaskRecord } from "@earendil-works/pi-durable";
import type { JsonValue } from "@earendil-works/chord/json";
import { claimOf, CommitState, PendingWrites, prepareDocumentActions, type DocumentAction } from "./commit.ts";
import { addressParts, encodeIndexed, isCurrentOnly, num, parseJson, scopeColumns, type Sql } from "./rows.ts";

export interface PgConnection extends Sql { end(): Promise<void> }
/** Spike-only crash markers: called inside a commit's transaction after its write, before `COMMIT`. */
export interface PgStorageHooks { beforeCommit?(batches: readonly (readonly StorageWrite[])[]): Promise<void> }
type Order = "ascending" | "descending";
type StoredTask = TaskRecord<JsonValue, JsonValue, JsonValue>;
type StoredEntry = { readonly entry: EntryRecord; readonly commitSeq: Seq };

/** `storage/scan.js:7-24`: a scan's order and position; a cursor continues in its own order. */
function scanStart(requested: Order | undefined, cursor: Cursor | undefined, fallback: Order): { order: Order; after: number | undefined } {
  if (requested !== undefined && requested !== "ascending" && requested !== "descending") throw new StorageRequestError(`Invalid scan order: ${String(requested)}`);
  if (cursor === undefined) return { order: requested ?? fallback, after: undefined };
  const { after, order: stored } = cursor as { after?: unknown; order?: unknown };
  if (typeof after !== "number" || !Number.isSafeInteger(after)) throw new StorageRequestError("Invalid storage cursor");
  if (stored !== undefined && stored !== "ascending" && stored !== "descending") throw new StorageRequestError("Invalid storage cursor");
  const order = (stored as Order | undefined) ?? fallback;
  if (requested !== undefined && requested !== order) throw new StorageRequestError(`The cursor continues a ${order} scan; the query asks for ${requested}`);
  return { order, after };
}

const cursorId = (cursor: Cursor | undefined): number | undefined => {
  const after = (cursor as { after?: unknown } | undefined)?.after;
  if (after === undefined) return undefined;
  if (typeof after !== "number" || !Number.isSafeInteger(after)) throw new StorageRequestError("Invalid storage cursor");
  return after;
};

function page<T extends { id: number }>(values: T[], limit: number, order: Order = "ascending"): Page<T, Cursor> {
  const items = values.slice(0, limit);
  if (values.length <= limit) return { items } as Page<T, Cursor>;
  return { items, next: { after: (items.at(-1) as T).id, order } } as Page<T, Cursor>;
}

const isAliveAt = (record: DocumentRecord, at: DocumentPoint) => (at === "current" ? record.retiredAt === undefined
  : record.createdAt <= at && (record.retiredAt === undefined || at < record.retiredAt));

/** Builds `WHERE` clauses with numbered parameters after `$1`, the session key. */
class Where {
  readonly clauses = ["session_key = $1"];
  readonly values: unknown[];
  constructor(key: string) { this.values = [key]; }
  add(clause: (p: string) => string, value: unknown): this { this.values.push(value); this.clauses.push(clause(`$${String(this.values.length)}`)); return this; }
  param(value: unknown): string { this.values.push(value); return `$${String(this.values.length)}`; }
  get sql(): string { return this.clauses.join(" AND "); }
}

export class PgStorage implements Storage {
  readonly #db: PgConnection;
  readonly #key: string;
  readonly #hooks: PgStorageHooks;
  #nextId: number;
  #closed = false;
  #closing: Promise<void> | undefined;
  #tail: Promise<unknown> = Promise.resolve();

  private constructor(db: PgConnection, key: string, nextId: number, hooks: PgStorageHooks) {
    this.#db = db;
    this.#key = key;
    this.#nextId = nextId;
    this.#hooks = hooks;
  }

  /** Opens `key`'s keyspace on a connected `db` (which it then owns): one statement, creating the metadata row if absent. */
  static async open(db: PgConnection, key: string, hooks: PgStorageHooks = {}): Promise<PgStorage> {
    try {
      const { rows } = await db.query(`INSERT INTO pd_meta (session_key, next_id, next_seq) VALUES ($1, 2, 1)
        ON CONFLICT (session_key) DO UPDATE SET session_key = excluded.session_key RETURNING next_id::text AS next_id`, [key]);
      return new PgStorage(db, key, num(rows[0]?.next_id), hooks);
    } catch (error) {
      await db.end().catch(() => undefined);
      throw error;
    }
  }

  get sessionKey(): string { return this.#key; }

  /** Every call runs alone on the connection, in call order; after `close()` it rejects (never throws synchronously). */
  #serial<T>(operation: () => Promise<T>): Promise<T> {
    if (this.#closed) return Promise.reject(new Error("PgStorage is closed"));
    const result = this.#tail.then(operation);
    this.#tail = result.then(() => undefined, () => undefined);
    return result;
  }

  async #rows(text: string, values: readonly unknown[]): Promise<Record<string, unknown>[]> {
    return (await this.#db.query(text, values)).rows;
  }

  commit(batches: readonly (readonly StorageWrite[])[], receive: (index: number, seq: Seq) => void, _context: Context): Promise<CommitResult> {
    return this.#serial(async () => {
      const seqs: Seq[] = [];
      let refused: { error: unknown } | undefined;
      let candidateNextId = this.#nextId;
      await this.#db.query("BEGIN");
      try {
        const { meta, state } = await CommitState.read(this.#db, this.#key, batches);
        let next = meta.nextSeq;
        const pending = new PendingWrites();
        for (const writes of batches) {
          const checked = await this.#checkBatch(state, pending, writes);
          if ("refused" in checked) {
            refused = { error: checked.refused };
            break;
          }
          const seq = next++ as Seq;
          state.apply(writes, checked.actions, seq);
          pending.add(writes, checked.actions, seq, state);
          seqs.push(seq);
          candidateNextId = Math.max(candidateNextId, this.#candidateNextId(writes));
        }
        await pending.flush(this.#db, this.#key, seqs.length > 0 ? { nextId: Math.max(meta.nextId, candidateNextId), nextSeq: next } : undefined);
        if (this.#hooks.beforeCommit) await this.#hooks.beforeCommit(batches);
        await this.#db.query("COMMIT");
      } catch (error) {
        await this.#db.query("ROLLBACK").catch(() => undefined);
        throw error;
      }
      this.#nextId = Math.max(this.#nextId, candidateNextId);
      for (const [index, seq] of seqs.entries()) receive(index, seq);
      return refused === undefined ? { stored: seqs.length } : { stored: seqs.length, refused: refused.error };
    });
  }

  /** `storage.js:145-167`: Durable's own checks of one batch; a copy reads its source, so the batches before it are written first. */
  async #checkBatch(state: CommitState, pending: PendingWrites, writes: readonly StorageWrite[]): Promise<{ actions: Map<number, DocumentAction> } | { refused: unknown }> {
    let actions: Map<number, DocumentAction>;
    try {
      actions = prepareDocumentActions(writes);
      state.check(writes, actions);
    } catch (error) {
      return { refused: error };
    }
    if (![...actions.values()].some((action) => action.copy !== undefined)) return { actions };
    await pending.flush(this.#db, this.#key);
    const calls = { failed: false };
    try {
      await this.#resolveCopies(actions, calls);
    } catch (error) {
      if (calls.failed) throw error;
      return { refused: error };
    }
    return { actions };
  }

  async mintId<I extends Id<string>>(): Promise<I> {
    this.#assertOpen();
    if (!Number.isSafeInteger(this.#nextId)) throw new Error("ID space is exhausted");
    return this.#nextId++ as unknown as I;
  }

  conversation(id: ConversationId, _context: Context): Promise<ConversationRecord | undefined> {
    return this.#serial(() => this.#readConversation(id));
  }

  scanConversations(query: ConversationQuery, limit: number, cursor: Cursor | undefined, _context: Context): Promise<Page<ConversationRecord, Cursor>> {
    return this.#serial(async () => {
      const start = scanStart(query.order, cursor, "ascending");
      const where = this.#scan(start);
      if (query.ownerConversationId !== undefined) where.add((p) => `owner_conversation_id = ${p}`, query.ownerConversationId);
      if (query.ownerTaskId !== undefined) where.add((p) => `owner_task_id = ${p}`, query.ownerTaskId);
      const rows = await this.#rows(`SELECT record FROM pd_conversations WHERE ${where.sql} ORDER BY id ${start.order === "ascending" ? "ASC" : "DESC"} LIMIT ${where.param(limit + 1)}`, where.values);
      return page(rows.map((row) => parseJson<ConversationRecord>(row.record)), limit, start.order);
    });
  }

  entry(id: EntryId, context: Context): Promise<StoredEntry | undefined>;
  entry(conversationId: ConversationId, id: EntryId, context: Context): Promise<StoredEntry | undefined>;
  entry(idOrConversationId: number, idOrContext: EntryId | Context, context?: Context): Promise<StoredEntry | undefined> {
    return this.#serial(() => this.#readEntry(idOrConversationId, idOrContext, context));
  }

  findLatestHeadMarker(conversationId: ConversationId, atOrBeforeEntryId: EntryId | undefined, _context: Context): Promise<(EntryRecord & { readonly head: EntryId }) | undefined> {
    return this.#serial(() => this.#readLatestHeadMarker(conversationId, atOrBeforeEntryId));
  }

  scanEntries(query: EntryQuery, limit: number, cursor: Cursor | undefined, _context: Context): Promise<Page<EntryRecord, Cursor>> {
    return this.#serial(() => this.#readEntries(query, limit, cursor));
  }

  task(id: TaskId, _context: Context): Promise<StoredTask | undefined> {
    return this.#serial(async () => {
      const row = (await this.#rows("SELECT record FROM pd_tasks WHERE session_key = $1 AND id = $2", [this.#key, id]))[0];
      return row === undefined ? undefined : parseJson<StoredTask>(row.record);
    });
  }

  scanTasks(query: TaskQuery, limit: number, cursor: Cursor | undefined, _context: Context): Promise<Page<StoredTask, Cursor>> {
    return this.#serial(async () => {
      const start = scanStart(query.order, cursor, "ascending");
      const where = this.#scan(start);
      if (query.conversationId !== undefined) where.add((p) => `conversation_id = ${p}`, query.conversationId);
      if (query.kind !== undefined) where.add((p) => `kind = ${p}`, encodeIndexed(query.kind));
      if (query.status !== undefined) where.add((p) => `status = ${p}`, query.status);
      if (query.abortRequested !== undefined) where.add((p) => `abort_requested = ${p}`, query.abortRequested);
      if (query.background !== undefined) where.add((p) => `background = ${p}`, query.background);
      const rows = await this.#rows(`SELECT record FROM pd_tasks WHERE ${where.sql} ORDER BY id ${start.order === "ascending" ? "ASC" : "DESC"} LIMIT ${where.param(limit + 1)}`, where.values);
      return page(rows.map((row) => parseJson<StoredTask>(row.record)), limit, start.order);
    });
  }

  submission(id: SubmissionId, _context: Context): Promise<SubmissionRecord | undefined> {
    return this.#serial(async () => {
      const row = (await this.#rows("SELECT record FROM pd_submissions WHERE session_key = $1 AND id = $2", [this.#key, id]))[0];
      return row === undefined ? undefined : parseJson<SubmissionRecord>(row.record);
    });
  }

  scanSubmissions(query: SubmissionQuery, limit: number, cursor: Cursor | undefined, _context: Context): Promise<Page<SubmissionRecord, Cursor>> {
    return this.#serial(async () => {
      const start = scanStart(query.order, cursor, "ascending");
      const where = this.#scan(start);
      if (query.conversationId !== undefined) where.add((p) => `conversation_id = ${p}`, query.conversationId);
      if (query.status !== undefined) where.add((p) => `status = ${p}`, query.status);
      const rows = await this.#rows(`SELECT record FROM pd_submissions WHERE ${where.sql} ORDER BY id ${start.order === "ascending" ? "ASC" : "DESC"} LIMIT ${where.param(limit + 1)}`, where.values);
      return page(rows.map((row) => parseJson<SubmissionRecord>(row.record)), limit, start.order);
    });
  }

  submissionByRequest(conversationId: ConversationId, requestId: string, _context: Context): Promise<SubmissionRecord | undefined> {
    return this.#serial(async () => {
      const row = (await this.#rows("SELECT record FROM pd_submissions WHERE session_key = $1 AND conversation_id = $2 AND request_id = $3",
        [this.#key, conversationId, encodeIndexed(requestId)]))[0];
      return row === undefined ? undefined : parseJson<SubmissionRecord>(row.record);
    });
  }

  findDocument(address: DocumentAddress, at: DocumentPoint, _context: Context): Promise<DocumentRecord | undefined> {
    return this.#serial(async () => {
      const parts = addressParts(address);
      const values: unknown[] = [this.#key, parts.kind, parts.scopeKind, parts.ownerId, parts.family, parts.keyValue];
      const alive = at === "current" ? "retired_at IS NULL" : "created_at <= $7 AND (retired_at IS NULL OR retired_at > $7)";
      if (at !== "current") values.push(at);
      const row = (await this.#rows(`SELECT record FROM pd_documents WHERE session_key = $1 AND kind = $2 AND scope_kind = $3 AND owner_id = $4 AND family = $5
        AND key_value = $6 AND ${alive} ORDER BY created_at DESC LIMIT 1`, values))[0];
      return row === undefined ? undefined : parseJson<DocumentRecord>(row.record);
    });
  }

  document(id: DocumentId, at: DocumentPoint, _context: Context): Promise<StoredDocument | undefined> {
    return this.#serial(() => this.#materializeDocument(id, at));
  }

  scanDocuments(query: DocumentQuery, limit: number, cursor: Cursor | undefined, _context: Context): Promise<Page<DocumentRecord, Cursor>> {
    return this.#serial(async () => {
      const scope = scopeColumns(query.scope);
      const where = new Where(this.#key).add((p) => `scope_kind = ${p}`, scope.scopeKind).add((p) => `owner_id = ${p}`, scope.ownerId)
        .add((p) => `id > ${p}`, cursorId(cursor) ?? -1);
      if (query.kind !== undefined) where.add((p) => `kind = ${p}`, encodeIndexed(query.kind));
      if (query.at === "current") where.clauses.push("retired_at IS NULL");
      else where.add((p) => `created_at <= ${p} AND (retired_at IS NULL OR retired_at > ${p})`, query.at);
      const rows = await this.#rows(`SELECT record FROM pd_documents WHERE ${where.sql} ORDER BY id LIMIT ${where.param(limit + 1)}`, where.values);
      return page(rows.map((row) => parseJson<DocumentRecord>(row.record)), limit);
    });
  }

  /** Refuses new calls at once, lets the calls underway finish, then releases the connection. */
  close(_context: Context): Promise<void> {
    if (this.#closing === undefined) {
      this.#closed = true;
      this.#closing = this.#tail.then(() => this.#db.end());
    }
    return this.#closing;
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("PgStorage is closed");
  }

  #scan(start: { order: Order; after: number | undefined }): Where {
    const where = new Where(this.#key);
    return start.order === "ascending" ? where.add((p) => `id > ${p}`, start.after ?? -1) : where.add((p) => `id < ${p}`, start.after ?? Number.MAX_SAFE_INTEGER);
  }

  async #readConversation(id: number): Promise<ConversationRecord | undefined> {
    const row = (await this.#rows("SELECT record FROM pd_conversations WHERE session_key = $1 AND id = $2", [this.#key, id]))[0];
    return row === undefined ? undefined : parseJson<ConversationRecord>(row.record);
  }

  /** `storage.js:206-237`. */
  async #readEntry(idOrConversationId: number, idOrContext: unknown, context: unknown): Promise<StoredEntry | undefined> {
    const id = context === undefined ? idOrConversationId : typeof idOrContext === "number" ? idOrContext : undefined;
    if (id === undefined) throw new StorageRequestError("Storage.entry() requires an entry ID");
    let conversation: ConversationRecord | undefined;
    if (context !== undefined) {
      conversation = await this.#readConversation(idOrConversationId);
      if (conversation === undefined) throw new StorageRequestError(`Unknown conversation: ${String(idOrConversationId)}`);
    }
    const row = (await this.#rows("SELECT record, commit_seq::text AS commit_seq FROM pd_entries WHERE session_key = $1 AND id = $2", [this.#key, id]))[0];
    if (row === undefined) return undefined;
    const entry = parseJson<EntryRecord>(row.record);
    if (conversation !== undefined) {
      let upperEntryId = Number.POSITIVE_INFINITY;
      while (conversation.id !== entry.conversationId) {
        if (conversation.parent === undefined) return undefined;
        upperEntryId = Math.min(upperEntryId, conversation.parent.at);
        conversation = await this.#readConversation(conversation.parent.conversationId) as ConversationRecord;
      }
      if (entry.id > upperEntryId) return undefined;
    }
    return { entry, commitSeq: num(row.commit_seq) as Seq };
  }

  /** `storage.js:238-254`. */
  async #readLatestHeadMarker(conversationId: number, atOrBeforeEntryId: number | undefined): Promise<(EntryRecord & { readonly head: EntryId }) | undefined> {
    let conversation = await this.#readConversation(conversationId);
    if (conversation === undefined) throw new StorageRequestError(`Unknown conversation: ${String(conversationId)}`);
    let upper = atOrBeforeEntryId;
    for (;;) {
      const row = upper === undefined
        ? (await this.#rows("SELECT record FROM pd_entries WHERE session_key = $1 AND conversation_id = $2 AND head IS NOT NULL ORDER BY id DESC LIMIT 1", [this.#key, conversation.id]))[0]
        : (await this.#rows("SELECT record FROM pd_entries WHERE session_key = $1 AND conversation_id = $2 AND head IS NOT NULL AND id <= $3 ORDER BY id DESC LIMIT 1",
          [this.#key, conversation.id, upper]))[0];
      if (row !== undefined) return parseJson<EntryRecord & { readonly head: EntryId }>(row.record);
      if (conversation.parent === undefined) return undefined;
      upper = upper === undefined ? conversation.parent.at : Math.min(upper, conversation.parent.at);
      conversation = await this.#readConversation(conversation.parent.conversationId) as ConversationRecord;
    }
  }

  /** `storage.js:255-288`: newest first through the fork chain, each ancestor up to its fork point. */
  async #readEntries(query: EntryQuery, limit: number, cursor: Cursor | undefined): Promise<Page<EntryRecord, Cursor>> {
    const { order, after } = scanStart(query.order, cursor, "descending");
    if (order === "ascending") return this.#readEntriesAscending(query, limit, after);
    let conversation = await this.#readConversation(query.conversationId);
    if (conversation === undefined) throw new StorageRequestError(`Unknown conversation: ${String(query.conversationId)}`);
    let upper = query.maxEntryId as number | undefined;
    if (after !== undefined) upper = Math.min(upper ?? Number.MAX_SAFE_INTEGER, after - 1);
    const values: EntryRecord[] = [];
    for (;;) {
      const where = new Where(this.#key).add((p) => `conversation_id = ${p}`, conversation.id);
      if (query.minEntryId !== undefined) where.add((p) => `id >= ${p}`, query.minEntryId);
      if (upper !== undefined) where.add((p) => `id <= ${p}`, upper);
      const rows = await this.#rows(`SELECT record FROM pd_entries WHERE ${where.sql} ORDER BY id DESC LIMIT ${where.param(limit + 1 - values.length)}`, where.values);
      values.push(...rows.map((row) => parseJson<EntryRecord>(row.record)));
      if (values.length > limit || conversation.parent === undefined) break;
      upper = upper === undefined ? conversation.parent.at : Math.min(upper, conversation.parent.at);
      if (query.minEntryId !== undefined && upper < query.minEntryId) break;
      conversation = await this.#readConversation(conversation.parent.conversationId) as ConversationRecord;
    }
    return page(values, limit, "descending");
  }

  /** `storage.js:290-327`: oldest first, the fork chain's segments from the root forward. */
  async #readEntriesAscending(query: EntryQuery, limit: number, after: number | undefined): Promise<Page<EntryRecord, Cursor>> {
    const segments: { conversationId: number; upper: number | undefined }[] = [];
    let conversation = await this.#readConversation(query.conversationId);
    if (conversation === undefined) throw new StorageRequestError(`Unknown conversation: ${String(query.conversationId)}`);
    let upper = query.maxEntryId as number | undefined;
    for (;;) {
      segments.push({ conversationId: conversation.id, upper });
      if (conversation.parent === undefined) break;
      upper = upper === undefined ? conversation.parent.at : Math.min(upper, conversation.parent.at);
      if (query.minEntryId !== undefined && upper < query.minEntryId) break;
      conversation = await this.#readConversation(conversation.parent.conversationId) as ConversationRecord;
    }
    let lower = query.minEntryId as number | undefined;
    if (after !== undefined) lower = Math.max(lower ?? after + 1, after + 1);
    const values: EntryRecord[] = [];
    for (const segment of segments.reverse()) {
      const where = new Where(this.#key).add((p) => `conversation_id = ${p}`, segment.conversationId);
      if (lower !== undefined) where.add((p) => `id >= ${p}`, lower);
      if (segment.upper !== undefined) where.add((p) => `id <= ${p}`, segment.upper);
      const rows = await this.#rows(`SELECT record FROM pd_entries WHERE ${where.sql} ORDER BY id ASC LIMIT ${where.param(limit + 1 - values.length)}`, where.values);
      values.push(...rows.map((row) => parseJson<EntryRecord>(row.record)));
      if (values.length > limit) break;
    }
    return page(values, limit, "ascending");
  }

  /**
   * `storage.js:467-492` in one statement: the record, and its revisions from the latest base at or below the point up
   * to it. The calls are serialised, so no commit of this storage lands between the record and its revisions.
   */
  async #materializeDocument(id: number, at: DocumentPoint, calls?: { failed: boolean }): Promise<StoredDocument | undefined> {
    const upper = at === "current" ? Number.MAX_SAFE_INTEGER : at;
    let rows: Record<string, unknown>[];
    try {
      rows = await this.#rows(`SELECT d.record, r.seq::text AS seq, r.kind, r.version, r.content FROM pd_documents d
        LEFT JOIN LATERAL (SELECT rr.seq, rr.kind, rr.version, rr.content FROM pd_document_revisions rr
          WHERE rr.session_key = d.session_key AND rr.document_id = d.id AND rr.seq <= $3
            AND rr.seq >= coalesce((SELECT b.seq FROM pd_document_revisions b WHERE b.session_key = d.session_key AND b.document_id = d.id AND b.kind = 'base'
              AND b.seq <= $3 ORDER BY b.seq DESC LIMIT 1), $3 + 1)
          ORDER BY rr.seq) r ON true
        WHERE d.session_key = $1 AND d.id = $2`, [this.#key, id, upper]);
    } catch (error) {
      // `storage.js:36-53` (`watchCalls`): a failing database call makes a copy's failure fatal, not a refusal.
      if (calls) calls.failed = true;
      throw error;
    }
    const first = rows[0];
    if (first === undefined) return undefined;
    const record = parseJson<DocumentRecord>(first.record);
    if (at !== "current" && isCurrentOnly(record)) throw new StorageRequestError(`Document ${String(id)} does not retain historical content`);
    if (!isAliveAt(record, at)) return undefined;
    const revisions = rows.filter((row) => row.seq !== null);
    const base = revisions[0];
    if (base === undefined || base.kind !== "base") throw new Error(`Document ${String(id)} is missing a required base`);
    let value = parseJson<JsonValue>(base.content);
    const tail = revisions.slice(1);
    for (const revision of tail) {
      if (revision.kind !== "delta" || num(revision.version) !== num(base.version)) throw new Error(`Document ${String(id)} crosses a stored version boundary without a base`);
      value = apply(value, parseJson<Op[]>(revision.content));
    }
    return { record, version: num(base.version), value, deltasSinceBase: tail.length } as StoredDocument;
  }

  #candidateNextId(writes: readonly StorageWrite[]): number {
    let nextId = this.#nextId;
    for (const write of writes) {
      const id = claimOf(write)?.id;
      if (id !== undefined) nextId = Math.max(nextId, id + 1);
    }
    return nextId;
  }

  /** `storage.js:503-526`: each copy resolved to a base of its source's state before this batch. */
  async #resolveCopies(actions: Map<number, DocumentAction>, calls: { failed: boolean }): Promise<void> {
    for (const [id, action] of actions) {
      if (action.copy === undefined) continue;
      try {
        const stored = await this.#materializeDocument(action.copy.id, action.copy.at, calls);
        if (stored === undefined) throw new Error(`Fork source document ${String(action.copy.id)} cannot be read`);
        const create = action.create;
        if (stored.record.scope.kind !== "conversation" || create?.scope.kind !== "conversation" || stored.record.kind !== create.kind
          || stored.record.key !== create.key || stored.record.history !== create.history || stored.record.fork !== create.fork) {
          throw new Error(`Fork source document ${String(action.copy.id)} does not match the copied record`);
        }
        action.content = { kind: "base", version: stored.version, value: stored.value } as DocumentAction["content"];
      } catch (error) {
        throw new Error(`Document copy ${String(id)} was rejected`, { cause: error });
      }
    }
  }
}
