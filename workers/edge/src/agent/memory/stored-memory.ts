/**
 * How a session's memory survives an eviction (card #1290): the plain-JSON form
 * `DurableEnvelopeStore` writes, and the guarded read that turns it back into
 * the two ledgers.
 *
 * A codec rather than serialization on the ledgers themselves, for the same
 * reason `durable-envelope-store.ts` guards the clarification it reads back:
 * `ctx.storage.get` answers `unknown`, structured clone does not restore a
 * class prototype, and an older or newer deployment could have written a shape
 * this one no longer reads. Every field is checked — a record that is only half
 * readable is dropped rather than trusted — and both ledgers come back through
 * their own `restored` factory, so a stored value that was over the cap when it
 * was written (or was never written by these methods at all) is trimmed on the
 * way in. That is the port of Python's `enforce_bounds`-on-restore validator.
 */
import { isJsonRecord } from "../json-record.ts";
import {
  FactLedger,
  PACINGS,
  type HardConstraintRecord,
  type Pacing,
  type SceneReferenceRecord,
} from "./fact-ledger.ts";
import { RetainedEntityLedger, type RetainedEntity } from "./retained-entity-ledger.ts";
import { EMPTY_SESSION_MEMORY, type SessionMemory } from "./session-memory.ts";

/** The three fields every stored fact record carries, or nothing. */
interface StoredFact {
  readonly id: string;
  readonly recordedAt: string;
  readonly supersededBy: string | null;
}

function storedFact(value: unknown): StoredFact | null {
  if (!isJsonRecord(value)) return null;
  const { id, recordedAt, supersededBy } = value;
  if (typeof id !== "string" || typeof recordedAt !== "string") return null;
  if (supersededBy !== null && typeof supersededBy !== "string") return null;
  return { id, recordedAt, supersededBy };
}

function storedPacing(value: unknown): Pacing | null {
  return PACINGS.find((pacing) => pacing === value) ?? null;
}

function storedConstraint(value: unknown): HardConstraintRecord | null {
  const base = storedFact(value);
  const pacing = isJsonRecord(value) ? storedPacing(value.value) : null;
  if (base === null || pacing === null) return null;
  return { ...base, kind: "pacing", value: pacing };
}

function storedScene(value: unknown): SceneReferenceRecord | null {
  const base = storedFact(value);
  if (base === null || !isJsonRecord(value)) return null;
  const { pointId, value: text } = value;
  if (typeof pointId !== "string" || typeof text !== "string") return null;
  return { ...base, kind: "episode_scene", pointId, value: text };
}

function storedEntity(value: unknown): RetainedEntity | null {
  if (!isJsonRecord(value)) return null;
  const { toolName, value: text } = value;
  if (typeof toolName !== "string" || typeof text !== "string") return null;
  return { toolName, value: text };
}

/** Every readable member of a stored list, in the order it was written. */
function storedList<Item>(value: unknown, read: (one: unknown) => Item | null): Item[] {
  return Array.isArray(value) ? value.flatMap((one) => read(one) ?? []) : [];
}

function storedFacts(value: unknown): FactLedger {
  if (!isJsonRecord(value)) return FactLedger.empty;
  return FactLedger.restored(
    storedList(value.hardConstraints, storedConstraint),
    storedList(value.sceneReferences, storedScene),
  );
}

/** The two ledgers as this deployment can read them back. */
export function storedMemory(value: unknown): SessionMemory {
  if (!isJsonRecord(value)) return EMPTY_SESSION_MEMORY;
  return {
    facts: storedFacts(value.facts),
    retainedEntities: RetainedEntityLedger.restored(
      storedList(value.retainedEntities, storedEntity),
    ),
  };
}

/** The plain JSON a Durable Object write can carry — no class instances. */
export function encodedMemory(memory: SessionMemory): Record<string, unknown> {
  const { facts, retainedEntities } = memory;
  return {
    facts: {
      hardConstraints: [...facts.hardConstraints],
      sceneReferences: [...facts.sceneReferences],
    },
    retainedEntities: [...retainedEntities.entities],
  };
}
