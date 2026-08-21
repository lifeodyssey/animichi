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

/** Ledger that moves from `before` to `after` only when the container runs. */
function unknownExitLedger(before: string | null, after: string | null): MigrationBoundaries {
  let head = before;
  return {
    runContainer: (): Promise<ContainerOutcome> => {
      head = after;
      return Promise.resolve({ kind: "unknown_exit" });
    },
    readAppliedHead: (): Promise<string | null> => Promise.resolve(head),
  };
}

/** Pre-run and post-run ledger reads differ; the post-run value appears only after the container starts. */
function headsAroundContainer(
  outcome: ContainerOutcome,
  preRun: () => Promise<string | null>,
  postRun: () => Promise<string | null>,
): MigrationBoundaries {
  let started = false;
  return {
    runContainer: (): Promise<ContainerOutcome> => {
      started = true;
      return Promise.resolve(outcome);
    },
    readAppliedHead: (): Promise<string | null> => (started ? postRun : preRun)(),
  };
}

describe("runMigration coded exits", () => {
  it("keeps a clean coded exit as success with the applied head", async () => {
    const result = await runMigration(DSN, bounds({ kind: "success", exitCode: 0 }), HEAD);
    expect(result).toEqual({
      kind: "success",
      exitCode: 0,
      appliedHead: HEAD,
      pathVerification: "verified",
    });
  });

  it("passes a coded failure through unchanged", async () => {
    const result = await runMigration(DSN, bounds({ kind: "failure", exitCode: 3 }), HEAD);
    expect(result).toEqual({ kind: "failure", exitCode: 3 });
  });
});

describe("runMigration unknown-exit ledger judgment", () => {
  it("succeeds as unverified when unknown_exit leaves the ledger at the expected head", async () => {
    const result = await runMigration(DSN, unknownExitLedger(HEAD, HEAD), HEAD);
    expect(result).toEqual({
      kind: "success",
      exitCode: 0,
      appliedHead: HEAD,
      pathVerification: "unverified",
    });
  });

  it("succeeds as verified when unknown_exit advances the ledger to the expected head", async () => {
    const result = await runMigration(DSN, unknownExitLedger(OTHER, HEAD), HEAD);
    expect(result).toEqual({
      kind: "success",
      exitCode: 0,
      appliedHead: HEAD,
      pathVerification: "verified",
    });
  });

  it("succeeds as verified when unknown_exit applies the first revision onto an empty ledger", async () => {
    const result = await runMigration(DSN, unknownExitLedger(null, HEAD), HEAD);
    expect(result).toEqual({
      kind: "success",
      exitCode: 0,
      appliedHead: HEAD,
      pathVerification: "verified",
    });
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

describe("runMigration pre-run missing ledger", () => {
  it("reports verified when unknown_exit applies onto a missing revisions table", async () => {
    const result = await runMigration(
      DSN,
      headsAroundContainer(
        { kind: "unknown_exit" },
        () => Promise.reject(new Error('relation "public.atlas_schema_revisions" does not exist')),
        () => Promise.resolve(HEAD),
      ),
      HEAD,
    );
    expect(result).toEqual({
      kind: "success",
      exitCode: 0,
      appliedHead: HEAD,
      pathVerification: "verified",
    });
  });

  it("reports verified when a pre-run undefined_table SQLSTATE is an empty ledger", async () => {
    const missing = Object.assign(new Error("undefined_table"), { code: "42P01" });
    const result = await runMigration(
      DSN,
      headsAroundContainer(
        { kind: "unknown_exit" },
        () => Promise.reject(missing),
        () => Promise.resolve(HEAD),
      ),
      HEAD,
    );
    expect(result).toEqual({
      kind: "success",
      exitCode: 0,
      appliedHead: HEAD,
      pathVerification: "verified",
    });
  });
});

describe("runMigration ledger read failures", () => {
  it("reports unverified when a pre-run ledger read fails and unknown_exit lands at expectedHead", async () => {
    const result = await runMigration(
      DSN,
      headsAroundContainer(
        { kind: "unknown_exit" },
        () => Promise.reject(new Error("connect timeout")),
        () => Promise.resolve(HEAD),
      ),
      HEAD,
    );
    expect(result).toEqual({
      kind: "success",
      exitCode: 0,
      appliedHead: HEAD,
      pathVerification: "unverified",
    });
  });

  it("propagates a post-run ledger read failure", async () => {
    const failure = new Error("ledger read failed");
    await expect(
      runMigration(
        DSN,
        headsAroundContainer(
          { kind: "unknown_exit" },
          () => Promise.resolve(HEAD),
          () => Promise.reject(failure),
        ),
        HEAD,
      ),
    ).rejects.toBe(failure);
  });
});
