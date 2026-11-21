/**
 * The jsonb write boundary (#1630).
 *
 * A Prisma plan's jsonb column takes `JsonValue`, whose object arm is an index
 * signature (`{ readonly [key: string]: JsonValue }`). A domain INTERFACE — the
 * shape every snapshot and provenance value in this Worker is — has no implicit
 * index signature, so it is not assignable to that arm even when every field of
 * it is JSON by construction (`RunFailure`, `SourceOutcome`, `DiscoveryResult`).
 * A type alias would be; an interface will not be, whatever its contents.
 *
 * The alternative to naming that gap once is a hand-written literal at every
 * write, which would restate the snapshot shape and drift from it. So this is
 * the one place the gap is stated: the value is asserted, by the caller, to be a
 * JSON document. Every caller passes a value that came out of the domain as
 * plain data and is on its way into a jsonb column, which will refuse anything
 * that is not one.
 */
import type { JsonValue } from "@prisma/orm-postgres/contract/types";

/** A parsed or built JSON document, as the jsonb codec accepts it. */
export function asJsonValue(value: object): JsonValue {
  return value as JsonValue;
}
