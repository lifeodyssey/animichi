import { describe, expect, it, vi } from "vitest";
import { pointsByBangumiId } from "../src/api/work-points";
import { PREVIEW, fakeDb, waitUntilSpy } from "./work-points.fixtures";

// Failure-signal audit (docs/specs/2026-08-26-system-health-audit.md sec 2.4):
// the background ingest handed to waitUntil used to swallow its rejection.
describe("pointsByBangumiId background ingest signal", () => {
  it("swallows background ingest rejection inside the waitUntil promise and logs it", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const ingest = Promise.reject(new Error("upstream unavailable"));
    void ingest.catch(() => undefined);
    const { db } = fakeDb({ ingest });
    const { waitUntil, scheduled } = waitUntilSpy();

    const result = await pointsByBangumiId(db, "115908", { waitUntil });
    await Promise.allSettled(scheduled);

    expect(result).toMatchObject({ rows: [PREVIEW], partial: true });
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("115908"));
    errorSpy.mockRestore();
  });
});
