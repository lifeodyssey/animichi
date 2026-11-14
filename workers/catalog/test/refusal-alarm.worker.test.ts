/**
 * The refusal alarm (#1784): an ingest that parks a refusal raises it, once per
 * source while that source has no live refusal on record and never for a
 * fault, and the default alarm writes one structured error record. The ingest
 * runs over the doubles in `./ingest-failure-doubles`.
 */
import { describe, expect, it, vi } from "vitest";
import { consoleRefusalAlarm, type UpstreamRefusal } from "../src/ingest/refusal-alarm";
import { anitabiAnswering, ingestAgainst, parkedStore, WORK } from "./ingest-failure-doubles";

describe("the refusal alarm", () => {
  it("raises the first refusal from a source with what to do about it", async () => {
    const raised: UpstreamRefusal[] = [];

    await ingestAgainst(anitabiAnswering(403), parkedStore(), raised);

    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({ upstream: "anitabi", workId: WORK });
    expect(raised[0]?.detail).toContain("retrying will not help");
  });

  it("stays silent while the same source already has a live refusal on record", async () => {
    const raised: UpstreamRefusal[] = [];
    const parked = parkedStore();
    parked.liveRefusals.add("anitabi");

    await ingestAgainst(anitabiAnswering(403), parked, raised);

    expect(raised).toEqual([]);
  });

  it("raises nothing for a fault", async () => {
    const raised: UpstreamRefusal[] = [];

    await ingestAgainst(anitabiAnswering(500), parkedStore(), raised);

    expect(raised).toEqual([]);
  });
});

describe("the default refusal alarm", () => {
  it("writes one structured error record keyed on the refusal event", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    consoleRefusalAlarm().upstreamRefused({ upstream: "anitabi", workId: WORK, detail: "refused" });

    expect(error).toHaveBeenCalledExactlyOnceWith({
      event: "ingest.upstream_refused", upstream: "anitabi", work_id: WORK, detail: "refused",
    });
    error.mockRestore();
  });
});
