import { describe, expect, it } from "vitest";
import { appendRawHistory, cleanupRawHistory, DEFAULT_KEEP_COUNT } from "../src/ingest/raw_history";
import { recordingCatalogPrisma } from "./fakes/plan-inspection";

/**
 * Raw payload retention, as the worker pool can see it (#1006 AC5, #1630).
 *
 * The sweep used to decide its own candidates: it read EVERY history row and
 * counted downsides per (work_id, source) in JavaScript, then deleted the seqs it
 * had chosen. The plan lane moved that ranking into the statement
 * (`row_number() over (partition by work_id, source order by seq desc)`), so the
 * database picks the candidates and the sweep only decides what to do with them.
 *
 * That splits the suite. The RANKING is now SQL, so whether it really keeps the
 * newest N and whether an active run's evidence survives is proved against real
 * Postgres in daily-run.integration.test.ts. What stays here is the worker-side
 * contract: how many statements the sweep issues, that it issues no DELETE when
 * nothing falls outside the window, and that the payload is bound as one JSON
 * document rather than a string of a string.
 */

/** The rows the ranked read projects, newest-first within one work/source group. */
const RANKED = (ranks: readonly number[]) => ranks.map((rank) => ({ seq: 100 - rank, rank }));

describe("Raw payload retention (AC5)", () => {
  it("defaults to keeping the newest two payloads per work/source", () => {
    expect(DEFAULT_KEEP_COUNT).toBe(2);
  });

  it("issues the ranked read then one DELETE, binding the out-of-window seqs", async () => {
    // Ranks 1 and 2 are kept; 3 and 4 are beyond the window.
    const seam = recordingCatalogPrisma(RANKED([1, 2, 3, 4]), [{ seq: 97 }, { seq: 96 }]);

    await expect(cleanupRawHistory(seam.query, "d-2")).resolves.toBe(2);

    expect(seam.statements()).toBe(2);
    const params = seam.params();
    expect(params).toEqual(expect.arrayContaining([97, 96, "d-2"]));
    // The kept rows are never named in the DELETE.
    expect(params).not.toContain(99);
    expect(params).not.toContain(98);
  });

  it("prunes nothing when every work/source group is within the keep bound", async () => {
    const seam = recordingCatalogPrisma(RANKED([1, 2]));

    await expect(cleanupRawHistory(seam.query, "d-1")).resolves.toBe(0);

    // One statement: the ranked read. No DELETE is issued at all.
    expect(seam.statements()).toBe(1);
  });

  it("honours an explicit keep count", async () => {
    const seam = recordingCatalogPrisma(RANKED([1, 2, 3]), [{ seq: 97 }]);

    await expect(cleanupRawHistory(seam.query, "d-1", 2)).resolves.toBe(1);
    expect(seam.statements()).toBe(2);
  });

  it("rejects a non-positive keep count", async () => {
    const seam = recordingCatalogPrisma(RANKED([1]));
    await expect(cleanupRawHistory(seam.query, "d-1", 0)).rejects.toThrow(/keepCount/);
    expect(seam.statements()).toBe(0);
  });
});

describe("Raw payload serialization (thread 8)", () => {
  it("binds the payload as ONE jsonb document, not a re-stringified one", async () => {
    const seam = recordingCatalogPrisma();
    const payload = { id: 1, name: "Sora" };

    await appendRawHistory(seam.query, { workId: "w-1", source: "bangumi", payload });

    // The plan binds the document itself; a lane that JSON.stringify'd it would
    // put a STRING here, and Postgres would store that string as a jsonb scalar.
    expect(seam.params()).toContainEqual(payload);
    expect(seam.params().some((value) => typeof value === "string" && value.includes("Sora"))).toBe(false);
  });
});
