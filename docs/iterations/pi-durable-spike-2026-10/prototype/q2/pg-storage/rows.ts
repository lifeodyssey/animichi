/**
 * How Durable's records map to the Postgres rows: JSON text, indexed strings JSON-encoded, a document's scope and
 * address columns. A port of `@earendil-works/pi-durable@1.5.2 dist/storage/sqlite/rows.js`, unchanged in meaning.
 */
import type { DocumentAddress, DocumentCreate, DocumentRecord } from "@earendil-works/pi-durable";

export interface Sql {
  query(text: string, values?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export const parseJson = <T>(value: unknown): T => JSON.parse(String(value)) as T;
export const encodeJson = (value: unknown): string => JSON.stringify(value);
/** Some bindings replace lone UTF-16 surrogates; JSON keeps an indexed string lossless (`rows.js:6-7`). */
export const encodeIndexed = (value: string): string => JSON.stringify(value);
/** `pg` returns `int8` as text; every stored id and seq is a safe integer, or the exhaustion case one past it. */
export const num = (value: unknown): number => Number(value);

type Scope = DocumentRecord["scope"];

export function scopeColumns(scope: Scope): { scopeKind: string; ownerId: number } {
  switch (scope.kind) {
    case "session": return { scopeKind: "session", ownerId: 0 };
    case "conversation": return { scopeKind: "conversation", ownerId: scope.conversationId };
    case "task": return { scopeKind: "task", ownerId: scope.taskId };
  }
}

export interface AddressParts { readonly kind: string; readonly scopeKind: string; readonly ownerId: number; readonly family: number; readonly keyValue: string }

export function addressParts(address: DocumentAddress | DocumentCreate | DocumentRecord): AddressParts {
  const scope = scopeColumns(address.scope);
  return { kind: encodeIndexed(address.kind), ...scope, family: address.key === undefined ? 0 : 1, keyValue: encodeIndexed(address.key ?? "") };
}

export const addressColumnsKey = (kind: string, scopeKind: string, ownerId: number, family: number, keyValue: string): string =>
  JSON.stringify([kind, scopeKind, ownerId, family, keyValue]);

export function addressKey(address: DocumentAddress | DocumentCreate | DocumentRecord): string {
  const parts = addressParts(address);
  return addressColumnsKey(parts.kind, parts.scopeKind, parts.ownerId, parts.family, parts.keyValue);
}

/** Whether a document keeps only its current state: its revisions go at each new base and at retirement. */
export const isCurrentOnly = (record: DocumentCreate | DocumentRecord): boolean => record.scope.kind !== "conversation" || record.history === "latest";

/** A document record's row cells, in `pd_documents` column order after `session_key`. */
export function documentRow(record: DocumentRecord): unknown[] {
  const parts = addressParts(record);
  return [record.id, parts.kind, parts.family, parts.keyValue, parts.scopeKind, parts.ownerId, record.createdAt, record.retiredAt ?? null, encodeJson(record)];
}
