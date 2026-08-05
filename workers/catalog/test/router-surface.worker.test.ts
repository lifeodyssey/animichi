import { describe, expect, it } from "vitest";
import { catalogRouter } from "../src/router";

/**
 * The public oRPC surface is read-only (issue #540): on-demand ingest moved to
 * the internal `IngestEntrypoint` named entrypoint. This test is
 * mutation-proof — it enumerates the router's procedures and snapshots the
 * exact allowed set, so re-adding (or renaming) any procedure fails here.
 */
const PUBLIC_PROCEDURES = [
  "search",
  "resolve",
  "pointsByWorkId",
  "spots",
  "nearby",
  "geocode",
  "route",
  "animeOverview",
] as const;

describe("public catalog procedure surface", () => {
  it("exposes exactly the read-only public procedures (no ingest)", () => {
    expect(Object.keys(catalogRouter).sort()).toEqual([...PUBLIC_PROCEDURES].sort());
  });

  it("does not expose ingest as a public procedure", () => {
    expect(catalogRouter).not.toHaveProperty("ingest");
  });
});
