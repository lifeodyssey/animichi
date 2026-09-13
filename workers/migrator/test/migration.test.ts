import { describe, expect, it, vi } from "vitest";
import {
  applyMigration,
  type ApplyBoundaries,
  type ApplyOutcome,
} from "../src/migration";
import { selectedMetadata } from "./selected-apply-fixtures";

const DSN = "postgresql://migrator:x@db/neondb";
const HEAD = "20260814191301_turn_idempotency_outbox";

function boundaries(outcome: ApplyOutcome): ApplyBoundaries {
  return {
    applyChain: (): Promise<ApplyOutcome> => Promise.resolve(outcome),
    readAppliedHead: (): Promise<string | null> => Promise.resolve(HEAD),
  };
}

describe("applyMigration", () => {
  it("applies the selected chain and reports the settled ledger head", async () => {
    const applyChain = vi.fn<ApplyBoundaries["applyChain"]>()
      .mockResolvedValue({ kind: "success", exitCode: 0 });
    const result = await applyMigration(DSN, {
      ...boundaries({ kind: "success", exitCode: 0 }), applyChain,
    }, selectedMetadata());
    expect(applyChain).toHaveBeenCalledWith(DSN, selectedMetadata());
    expect(result).toEqual({
      kind: "success", exitCode: 0, appliedHead: HEAD, pathVerification: "verified",
    });
  });

  it("passes a coded apply failure through unchanged", async () => {
    const result = await applyMigration(
      DSN, boundaries({ kind: "failure", exitCode: 3 }), selectedMetadata(),
    );
    expect(result).toEqual({ kind: "failure", exitCode: 3 });
  });

  it("passes a bounded-chain refusal through unchanged", async () => {
    const result = await applyMigration(
      DSN, boundaries({ kind: "refused", reason: "migration_path_conflict" }), selectedMetadata(),
    );
    expect(result).toEqual({ kind: "refused", reason: "migration_path_conflict" });
  });

  it("does not read the ledger after a failed apply", async () => {
    const readAppliedHead = vi.fn<ApplyBoundaries["readAppliedHead"]>();
    await applyMigration(DSN, {
      ...boundaries({ kind: "failure", exitCode: 1 }), readAppliedHead,
    }, selectedMetadata());
    expect(readAppliedHead).not.toHaveBeenCalled();
  });

  it("propagates a post-apply ledger read failure", async () => {
    const failure = new Error("ledger read failed");
    const readAppliedHead = (): Promise<string | null> => Promise.reject(failure);
    await expect(applyMigration(DSN, {
      ...boundaries({ kind: "success", exitCode: 0 }), readAppliedHead,
    }, selectedMetadata())).rejects.toBe(failure);
  });
});
