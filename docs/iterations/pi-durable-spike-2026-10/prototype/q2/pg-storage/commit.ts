/**
 * One `PgStorage.commit()` call: Durable's own checks, ported from `SqliteStorage`
 * (`@earendil-works/pi-durable@1.5.2 dist/storage/sqlite/commit.js`), with the reads and writes recast for Postgres so a
 * call costs few statements whatever its number of batches:
 * - `CommitState.read`: the keyspace's metadata row, locked `FOR UPDATE`, and every claimed id, touched document, delta's
 *   latest version and created address, in one statement;
 * - `PendingWrites.flush`: every accepted batch's rows, and the metadata, in one statement of data-modifying CTEs.
 * The checks themselves are SQLite's, line for line: the same refusals, in the same order, with the same messages.
 */
import type { DocumentContent, DocumentCopySource, DocumentCreate, DocumentId, DocumentRecord, StorageWrite } from "@earendil-works/pi-durable";
import { addressColumnsKey, addressKey, addressParts, documentRow, encodeIndexed, encodeJson, isCurrentOnly, num, parseJson, type AddressParts, type Sql } from "./rows.ts";

type Table = "conversation" | "entry" | "task" | "submission" | "document";

export interface DocumentAction {
  retire: boolean;
  create?: DocumentCreate;
  content?: DocumentContent;
  copy?: DocumentCopySource;
}

/** The record ID a write claims and its table, if it claims one (`commit.js:8-22`). */
export function claimOf(write: StorageWrite): { id: number; table: Table } | undefined {
  switch (write.type) {
    case "conversation":
    case "entry":
    case "task":
    case "submission":
      return { id: write.value.id, table: write.type };
    case "document.create":
    case "document.copy":
      return { id: write.record.id, table: "document" };
    case "document.change":
    case "document.retire":
      return undefined;
  }
}

/** One batch's writes per document; throws when a document gets two content commands or two retirements (`commit.js:24-68`). */
export function prepareDocumentActions(writes: readonly StorageWrite[]): Map<number, DocumentAction> {
  const actions = new Map<number, DocumentAction>();
  for (const write of writes) {
    if (write.type !== "document.create" && write.type !== "document.copy" && write.type !== "document.change" && write.type !== "document.retire") continue;
    const id = write.type === "document.create" || write.type === "document.copy" ? write.record.id : write.id;
    let action = actions.get(id);
    if (action === undefined) {
      action = { retire: false };
      actions.set(id, action);
    }
    switch (write.type) {
      case "document.create":
        if (action.create !== undefined || action.content !== undefined || action.copy !== undefined) throw new Error(`Document ${id} has more than one content command`);
        action.create = write.record;
        action.content = write.content;
        break;
      case "document.copy":
        if (action.create !== undefined || action.content !== undefined || action.copy !== undefined) throw new Error(`Document ${id} has more than one content command`);
        action.create = write.record;
        action.copy = write.source;
        break;
      case "document.change":
        if (action.content !== undefined || action.copy !== undefined) throw new Error(`Document ${id} has more than one content command`);
        action.content = write.content;
        break;
      case "document.retire":
        if (action.retire) throw new Error(`Document ${id} is retired more than once`);
        action.retire = true;
        break;
    }
  }
  return actions;
}

/** The single state read: the metadata row (locked), then ids, documents, versions and current incarnations. */
const STATE_SQL = `WITH meta AS MATERIALIZED (SELECT next_id, next_seq FROM pd_meta WHERE session_key = $1 FOR UPDATE)
SELECT 'meta' AS k, next_id::text AS a, next_seq::text AS b FROM meta
UNION ALL SELECT 'id', id::text, record_type FROM pd_record_ids WHERE session_key = $1 AND id = ANY($2::bigint[])
UNION ALL SELECT 'doc', id::text, record FROM pd_documents WHERE session_key = $1 AND id = ANY($3::bigint[])
UNION ALL SELECT 'ver', d.id::text, (SELECT r.version::text FROM pd_document_revisions r WHERE r.session_key = $1 AND r.document_id = d.id
  ORDER BY r.seq DESC LIMIT 1) FROM unnest($4::bigint[]) AS d(id)
UNION ALL SELECT 'cur', doc.id::text, json_build_array(doc.kind, doc.scope_kind, doc.owner_id, doc.family, doc.key_value)::text
  FROM unnest($5::text[], $6::text[], $7::bigint[], $8::smallint[], $9::text[]) AS a(kind, scope_kind, owner_id, family, key_value)
  JOIN pd_documents doc ON doc.session_key = $1 AND doc.kind = a.kind AND doc.scope_kind = a.scope_kind AND doc.owner_id = a.owner_id
    AND doc.family = a.family AND doc.key_value = a.key_value
  WHERE doc.retired_at IS NULL`;

/**
 * What the checks of one call's batches read: the stored state of every ID, document and address the batches touch,
 * read in one statement when the call starts, then advanced in memory by each accepted batch (`commit.js:69-237`).
 */
export class CommitState {
  readonly #recordIds: Map<number, string>;
  readonly #documents: Map<number, DocumentRecord>;
  readonly #versions: Map<number, number>;
  readonly #current: Map<string, number | undefined>;

  private constructor(recordIds: Map<number, string>, documents: Map<number, DocumentRecord>, versions: Map<number, number>, current: Map<string, number | undefined>) {
    this.#recordIds = recordIds;
    this.#documents = documents;
    this.#versions = versions;
    this.#current = current;
  }

  /** Locks the keyspace's metadata row and reads what the checks of `batches` need: one statement. */
  static async read(sql: Sql, key: string, batches: readonly (readonly StorageWrite[])[]): Promise<{ meta: { nextId: number; nextSeq: number }; state: CommitState }> {
    const ids = new Set<number>();
    const documentIds = new Set<number>();
    const deltaIds = new Set<number>();
    const addresses = new Map<string, AddressParts>();
    for (const writes of batches) {
      for (const write of writes) {
        const claim = claimOf(write);
        if (claim !== undefined) ids.add(claim.id);
        if (write.type === "document.create" || write.type === "document.copy") {
          documentIds.add(write.record.id);
          addresses.set(addressKey(write.record), addressParts(write.record));
        } else if (write.type === "document.change") {
          documentIds.add(write.id);
          if (write.content.kind === "delta") deltaIds.add(write.id);
        } else if (write.type === "document.retire") documentIds.add(write.id);
      }
    }
    const parts = [...addresses.values()];
    const { rows } = await sql.query(STATE_SQL, [key, [...ids], [...documentIds], [...deltaIds], parts.map((p) => p.kind), parts.map((p) => p.scopeKind),
      parts.map((p) => p.ownerId), parts.map((p) => p.family), parts.map((p) => p.keyValue)]);
    let meta: { nextId: number; nextSeq: number } | undefined;
    const recordIds = new Map<number, string>();
    const documents = new Map<number, DocumentRecord>();
    const versions = new Map<number, number>();
    const current = new Map<string, number | undefined>([...addresses.keys()].map((address) => [address, undefined]));
    for (const row of rows) {
      if (row.k === "meta") meta = { nextId: num(row.a), nextSeq: num(row.b) };
      else if (row.k === "id") recordIds.set(num(row.a), String(row.b));
      else if (row.k === "doc") documents.set(num(row.a), parseJson<DocumentRecord>(row.b));
      else if (row.k === "ver" && row.b !== null) versions.set(num(row.a), num(row.b));
      else if (row.k === "cur") {
        const [kind, scopeKind, ownerId, family, keyValue] = parseJson<[string, string, number, number, string]>(row.b);
        current.set(addressColumnsKey(kind, scopeKind, ownerId, family, keyValue), num(row.a));
      }
    }
    if (meta === undefined) throw new Error(`Durable Postgres metadata is missing for session ${key}`);
    return { meta, state: new CommitState(recordIds, documents, versions, current) };
  }

  /** Durable's own checks of one batch that need no copy source: throws the refusal. */
  check(writes: readonly StorageWrite[], actions: Map<number, DocumentAction>): void {
    this.#checkIds(writes);
    this.#checkDocuments(actions);
  }

  /** Advances the state past an accepted batch stored at `seq`, its copies resolved to their content. */
  apply(writes: readonly StorageWrite[], actions: Map<number, DocumentAction>, seq: number): void {
    for (const write of writes) {
      const claim = claimOf(write);
      if (claim !== undefined) this.#recordIds.set(claim.id, claim.table);
    }
    for (const [id, action] of actions) {
      if (action.create !== undefined) {
        const record = { ...action.create, createdAt: seq, ...(action.retire ? { retiredAt: seq } : {}) } as DocumentRecord;
        this.#documents.set(id, record);
        if (!action.retire) this.#current.set(addressKey(record), id);
      } else if (action.retire) {
        const record = { ...this.#documents.get(id), retiredAt: seq } as DocumentRecord;
        this.#documents.set(id, record);
        const key = addressKey(record);
        if (this.#current.get(key) === id) this.#current.set(key, undefined);
      }
      if (action.content !== undefined) this.#versions.set(id, action.content.version);
    }
  }

  document(id: number): DocumentRecord | undefined {
    return this.#documents.get(id);
  }

  #checkIds(writes: readonly StorageWrite[]): void {
    const claimed = new Map<number, string>();
    for (const write of writes) {
      const claim = claimOf(write);
      if (claim === undefined) continue;
      const { id, table } = claim;
      const existing = this.#recordIds.get(id);
      const earlier = claimed.get(id);
      if (table === "conversation" || table === "entry" || table === "document") {
        if (existing !== undefined) throw new Error(`ID ${id} already belongs to ${existing}`);
        if (earlier !== undefined) throw new Error(`ID ${id} is written more than once`);
      } else {
        if (existing !== undefined && existing !== table) throw new Error(`ID ${id} already belongs to ${existing}`);
        if (earlier !== undefined && earlier !== table) throw new Error(`ID ${id} is written as two record types`);
      }
      claimed.set(id, table);
    }
  }

  #checkDocuments(actions: Map<number, DocumentAction>): void {
    const liveCounts = new Map<string, number>();
    for (const [id, action] of actions) {
      if (action.copy !== undefined && actions.has(action.copy.id)) throw new Error(`Document copy ${id} source is changed in the copy batch`);
      const existing = this.#documents.get(id);
      if (action.create === undefined && existing === undefined) throw new Error(`Unknown document: ${id}`);
      if (action.create !== undefined && existing !== undefined) throw new Error(`Document ${id} already exists`);
      if (existing?.retiredAt !== undefined) throw new Error(`Document ${id} is retired`);
      if (action.content?.kind === "delta") {
        const previous = this.#versions.get(id);
        if (previous === undefined) throw new Error(`Document ${id} delta has no base`);
        if (previous !== action.content.version) throw new Error(`Document ${id} version transition requires a base`);
      }
      if (action.create === undefined && !action.retire) continue;
      const key = addressKey((action.create ?? existing) as DocumentRecord);
      let live = liveCounts.get(key);
      if (live === undefined) live = this.#current.get(key) === undefined ? 0 : 1;
      if (action.retire && existing !== undefined) live--;
      if (action.create !== undefined && !action.retire) live++;
      liveCounts.set(key, live);
    }
    for (const live of liveCounts.values()) if (live > 1) throw new Error("Document address already has a current incarnation");
  }
}

/**
 * The writes of the accepted batches not yet written, per table, as their net effect (`commit.js:254-370`): a task or
 * submission written twice is written once, as last written; a current-only document's revisions before its latest
 * base or retirement are dropped (and its stored ones deleted).
 */
export class PendingWrites {
  readonly #recordIds = new Map<number, string>();
  readonly #conversations: unknown[][] = [];
  readonly #entries: unknown[][] = [];
  readonly #tasks = new Map<number, unknown[]>();
  readonly #submissions = new Map<number, unknown[]>();
  readonly #documents = new Map<number, DocumentRecord>();
  readonly #cleared = new Set<number>();
  readonly #revisions = new Map<number, unknown[][]>();

  add(writes: readonly StorageWrite[], actions: Map<number, DocumentAction>, seq: number, state: CommitState): void {
    for (const write of writes) this.#addWrite(write, seq);
    for (const [id, action] of actions) this.#addDocument(id, action, seq, state.document(id) as DocumentRecord);
  }

  #addWrite(write: StorageWrite, seq: number): void {
    const claim = claimOf(write);
    if (claim !== undefined) this.#recordIds.set(claim.id, claim.table);
    switch (write.type) {
      case "conversation":
        this.#conversations.push([write.value.id, write.value.owner?.conversationId ?? null, write.value.owner?.taskId ?? null, encodeJson(write.value)]);
        break;
      case "entry":
        this.#entries.push([write.value.id, write.value.conversationId, write.value.head ?? null, seq, encodeJson(write.value)]);
        break;
      case "task":
        this.#tasks.set(write.value.id, [write.value.id, write.value.conversationId, encodeIndexed(write.value.kind), write.value.state.status,
          write.value.abortRequested, write.value.background, encodeJson(write.value)]);
        break;
      case "submission":
        this.#submissions.set(write.value.id, [write.value.id, write.value.conversationId,
          write.value.requestId === undefined ? null : encodeIndexed(write.value.requestId), write.value.status, encodeJson(write.value)]);
        break;
      default:
        break;
    }
  }

  #addDocument(id: number, action: DocumentAction, seq: number, record: DocumentRecord): void {
    if (action.create !== undefined || action.retire) this.#documents.set(id, record);
    const content = action.content;
    if (content !== undefined) {
      if (content.kind === "base" && isCurrentOnly(record)) this.#clear(id);
      const encoded = content.kind === "base" ? encodeJson(content.value) : encodeJson(content.ops);
      const revisions = this.#revisions.get(id) ?? [];
      this.#revisions.set(id, revisions);
      revisions.push([id, seq, content.kind, content.version, encoded]);
    }
    if (action.retire && isCurrentOnly(record)) this.#clear(id);
  }

  #clear(id: number): void {
    this.#cleared.add(id);
    this.#revisions.delete(id);
  }

  /**
   * Writes everything pending, and the keyspace's metadata when given, in one statement: each table's rows from one
   * `unnest` of typed arrays, chained as data-modifying CTEs (all see the statement's starting snapshot; no two touch
   * one row, as a document's cleared revisions are older than its new ones). Then forgets it.
   */
  async flush(sql: Sql, key: string, meta?: { nextId: number; nextSeq: number }): Promise<void> {
    const values: unknown[] = [key];
    const param = (value: unknown, type: string) => { values.push(value); return `$${String(values.length)}::${type}`; };
    const columns = (rows: unknown[][], index: number) => rows.map((row) => row[index] ?? null);
    const insert = (table: string, names: string, rows: unknown[][], types: string[], conflict = "") =>
      `INSERT INTO ${table} (session_key, ${names}) SELECT $1::text, * FROM unnest(${types.map((type, index) => param(columns(rows, index), `${type}[]`)).join(", ")}) ${conflict}`;
    const parts: string[] = [];
    if (this.#recordIds.size > 0) parts.push(insert("pd_record_ids", "id, record_type", [...this.#recordIds], ["bigint", "text"], "ON CONFLICT (session_key, id) DO NOTHING"));
    if (this.#conversations.length > 0) parts.push(insert("pd_conversations", "id, owner_conversation_id, owner_task_id, record", this.#conversations, ["bigint", "bigint", "bigint", "text"]));
    if (this.#entries.length > 0) parts.push(insert("pd_entries", "id, conversation_id, head, commit_seq, record", this.#entries, ["bigint", "bigint", "bigint", "bigint", "text"]));
    if (this.#tasks.size > 0) parts.push(insert("pd_tasks", "id, conversation_id, kind, status, abort_requested, background, record", [...this.#tasks.values()],
      ["bigint", "bigint", "text", "text", "boolean", "boolean", "text"], `ON CONFLICT (session_key, id) DO UPDATE SET conversation_id = excluded.conversation_id,
      kind = excluded.kind, status = excluded.status, abort_requested = excluded.abort_requested, background = excluded.background, record = excluded.record`));
    if (this.#submissions.size > 0) parts.push(insert("pd_submissions", "id, conversation_id, request_id, status, record", [...this.#submissions.values()],
      ["bigint", "bigint", "text", "text", "text"], `ON CONFLICT (session_key, id) DO UPDATE SET conversation_id = excluded.conversation_id,
      request_id = excluded.request_id, status = excluded.status, record = excluded.record`));
    if (this.#documents.size > 0) parts.push(insert("pd_documents", "id, kind, family, key_value, scope_kind, owner_id, created_at, retired_at, record",
      [...this.#documents.values()].map(documentRow), ["bigint", "text", "smallint", "text", "text", "bigint", "bigint", "bigint", "text"],
      "ON CONFLICT (session_key, id) DO UPDATE SET retired_at = excluded.retired_at, record = excluded.record"));
    if (this.#cleared.size > 0) parts.push(`DELETE FROM pd_document_revisions WHERE session_key = $1 AND document_id = ANY(${param([...this.#cleared], "bigint[]")})`);
    const revisions = [...this.#revisions.values()].flat();
    if (revisions.length > 0) parts.push(insert("pd_document_revisions", "document_id, seq, kind, version, content", revisions, ["bigint", "bigint", "text", "integer", "text"]));
    if (meta !== undefined) parts.push(`UPDATE pd_meta SET next_id = ${param(String(meta.nextId), "bigint")}, next_seq = ${param(meta.nextSeq, "bigint")} WHERE session_key = $1`);
    if (parts.length > 0) {
      const last = parts.pop() as string;
      await sql.query(parts.length === 0 ? last : `WITH ${parts.map((part, index) => `w${String(index)} AS (${part})`).join(",\n")}\n${last}`, values);
    }
    this.#recordIds.clear();
    this.#conversations.length = 0;
    this.#entries.length = 0;
    this.#tasks.clear();
    this.#submissions.clear();
    this.#documents.clear();
    this.#cleared.clear();
    this.#revisions.clear();
  }
}

export type { DocumentId };
