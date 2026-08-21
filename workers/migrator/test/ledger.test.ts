import { describe, expect, it } from "vitest";
import { NeonMigrationsLedger, type AtlasRevisionRow } from "../src/ledger";

const DSN = "postgresql://migrator:x@db/neondb";

function ledgerWith(row: AtlasRevisionRow | undefined): NeonMigrationsLedger {
  return new NeonMigrationsLedger(() => Promise.resolve(row));
}

describe("MigrationsLedger.readAppliedHead format", () => {
  it("returns the migration file basename when Atlas splits version and description", async () => {
    const ledger = ledgerWith({ version: "20260811000001", description: "turn_outcome" });
    expect(await ledger.readAppliedHead(DSN)).toBe("20260811000001_turn_outcome");
  });

  it("reconstitutes a basename whose description itself contains underscores", async () => {
    const ledger = ledgerWith({ version: "20260811000000", description: "table_turn_reservations" });
    expect(await ledger.readAppliedHead(DSN)).toBe("20260811000000_table_turn_reservations");
  });

  it("reconstitutes the drop_api_keys basename from the Atlas-split columns", async () => {
    const ledger = ledgerWith({ version: "20260809000032", description: "drop_api_keys" });
    expect(await ledger.readAppliedHead(DSN)).toBe("20260809000032_drop_api_keys");
  });

  it("returns null when the revisions table is empty", async () => {
    expect(await ledgerWith(undefined).readAppliedHead(DSN)).toBeNull();
  });

  it("returns the version alone when description is SQL NULL", async () => {
    const ledger = ledgerWith({ version: "20260811000001", description: null });
    expect(await ledger.readAppliedHead(DSN)).toBe("20260811000001");
  });

  it("returns the version alone when description is an empty string", async () => {
    const ledger = ledgerWith({ version: "20260811000001", description: "" });
    expect(await ledger.readAppliedHead(DSN)).toBe("20260811000001");
  });
});
