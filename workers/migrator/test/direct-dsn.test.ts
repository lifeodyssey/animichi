import { describe, expect, it } from "vitest";
import { assertDirectDsn, dsnHost } from "../src/direct-dsn";
import { previewPrisma } from "../src/prisma-control";
import { MIGRATIONS, TARGET } from "./sealed-migrations";

// #1124 AC3 — a `-pooler` DSN is rejected before any connection and before any SQL. The rule
// outlived the Atlas apply engine that first carried it (#1634): Prisma's control client is
// now the only thing that opens a connection, and `previewPrisma` is the first door it passes.

const POOLER_DSN = "postgresql://migrator:x@ep-fake-1-pooler.ap-southeast-1.aws.neon.tech/neondb";
const DIRECT_DSN = "postgresql://migrator:x@ep-fake-1.ap-southeast-1.aws.neon.tech/neondb";

function rejectedMessage(run: () => unknown): string {
  try {
    run();
    return "";
  } catch (error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
}

describe("pooled endpoints are refused before any connection (AC3)", () => {
  it("rejects a -pooler DSN", () => {
    expect(rejectedMessage(() => { assertDirectDsn(POOLER_DSN); })).toMatch(/pooled endpoint rejected/i);
  });

  it("does not interpolate the DSN into the reject error", () => {
    const message = rejectedMessage(() => { assertDirectDsn(POOLER_DSN); });
    expect(message).not.toContain("postgresql://");
    expect(message).not.toContain("migrator:x");
    expect(message).not.toContain(POOLER_DSN);
  });

  it("accepts a direct Neon host", () => {
    expect(dsnHost(DIRECT_DSN)).toBe("ep-fake-1.ap-southeast-1.aws.neon.tech");
    expect(() => { assertDirectDsn(DIRECT_DSN); }).not.toThrow();
  });

  it("refuses a pooled endpoint before the native preview opens a client", async () => {
    await expect(previewPrisma(POOLER_DSN, TARGET, MIGRATIONS)).rejects.toThrow(/pooled endpoint rejected/i);
  });
});
