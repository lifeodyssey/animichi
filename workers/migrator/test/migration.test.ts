import { describe, expect, it } from "vitest";
import { runMigration, type ContainerOutcome, type MigrationBoundaries } from "../src/migration";

const DSN = "postgresql://migrator:x@db/neondb";
const HEAD = "20260814191301_turn_idempotency_outbox";
const OTHER = "20260811000001_turn_outcome";

function bounds(outcome: ContainerOutcome, head: string | null = HEAD): MigrationBoundaries {
  return {
    runContainer: (): Promise<ContainerOutcome> => Promise.resolve(outcome),
    readAppliedHead: (): Promise<string | null> => Promise.resolve(head),
  };
}

describe("runMigration coded exits", () => {
  it("keeps a clean coded exit as success with the applied head", async () => {
    const result = await runMigration(DSN, bounds({ kind: "success", exitCode: 0 }), HEAD);
    expect(result).toEqual({ kind: "success", exitCode: 0, appliedHead: HEAD });
  });

  it("passes a coded failure through unchanged", async () => {
    const result = await runMigration(DSN, bounds({ kind: "failure", exitCode: 3 }), HEAD);
    expect(result).toEqual({ kind: "failure", exitCode: 3 });
  });
});

describe("runMigration unknown-exit ledger judgment", () => {
  it("succeeds when the applied head equals the expected head", async () => {
    const result = await runMigration(DSN, bounds({ kind: "unknown_exit" }), HEAD);
    expect(result).toEqual({ kind: "success", exitCode: 0, appliedHead: HEAD });
  });

  it("fails with applied and expected heads when they differ", async () => {
    const result = await runMigration(DSN, bounds({ kind: "unknown_exit" }, OTHER), HEAD);
    expect(result).toEqual({ kind: "head_mismatch", appliedHead: OTHER, expectedHead: HEAD });
  });

  it("fails with both heads when expectedHead is absent", async () => {
    const result = await runMigration(DSN, bounds({ kind: "unknown_exit" }));
    expect(result).toEqual({ kind: "head_mismatch", appliedHead: HEAD, expectedHead: null });
  });
});
