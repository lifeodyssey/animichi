/**
 * The apply that `MigratorApplyLock` runs, under the test's control (#1868).
 *
 * `test/apply-lock-workerd.ts` substitutes this module for `src/selected-migration` when it
 * bundles the Durable Object, so the class under test enters workerd exactly as it is written
 * and only its collaborator changes. That keeps the boundary real: the 30-second
 * `blockConcurrencyWhile` cap belongs to the platform, is compiled into this repository's
 * workerd binaries, and fires locally — what this module supplies is the duration that crosses
 * it, not the cap itself.
 *
 * The DSN is the control channel, because it is the one string the gate passes through
 * untouched. Nothing here opens a connection.
 */
import type { SelectedMetadata, SelectedMigration, SelectedPreflight } from "../src/selected-migration";

/** Every apply boundary this isolate has crossed, in the order the gate allowed them. */
let crossings: string[] = [];

/** `<label>@<milliseconds>` — the label names the apply, the number is how long it takes. */
interface ApplySpec {
  readonly label: string;
  readonly durationMs: number;
}

export function applySpec(label: string, durationMs: number): string {
  return `${label}@${String(durationMs)}`;
}

function parseApplySpec(dsn: string): ApplySpec {
  const [label = "unlabelled", duration = "0"] = dsn.split("@");
  return { label, durationMs: Number(duration) };
}

function takes(durationMs: number): Promise<void> {
  return new Promise((done) => setTimeout(done, durationMs));
}

export function applyCrossings(): readonly string[] {
  return [...crossings];
}

export function forgetApplyCrossings(): void {
  crossings = [];
}

export async function migrateSelected(dsn: string, _passwords: unknown, _metadata: SelectedMetadata): Promise<SelectedMigration> {
  const { label, durationMs } = parseApplySpec(dsn);
  crossings.push(`${label}:start`);
  await takes(durationMs);
  crossings.push(`${label}:end`);
  return { kind: "success", exitCode: 0 };
}

export function preflightSelected(dsn: string, _metadata: SelectedMetadata): Promise<SelectedPreflight> {
  return Promise.resolve({ compatible: false, error: parseApplySpec(dsn).label });
}
