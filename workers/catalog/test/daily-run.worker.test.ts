import { describe, expect, it } from "vitest";
import { runDailyIngestWith, type RunPlan, type RunPorts, type RunPolicy, type RunSnapshot, type RunWorkOutcome } from "../src/ingest/daily-run";
import { spendRequests } from "../src/ingest/budgets";

const POLICY: RunPolicy = {
  staleRunningMs: 15 * 60_000,
  tierIntervals: { high: 86400000, medium: 604800000, low: 2592000000 },
  newWorkCap: 5,
  keepHistory: 2,
  budget: { workLimit: 10, requestLimit: 20, runtimeLimitMs: 600000 },
};

function plan(runId: string): RunPlan {
  return {
    runId,
    epochMs: 1723000000000,
    discovery: [{ source: "current_season" as const, bangumiIds: ["1", "2", "3"] }],
    knownIds: new Set(),
    tiered: [
      { bangumiId: "1", tier: "high", lastIngestedAtMs: null },
      { bangumiId: "2", tier: "high", lastIngestedAtMs: null },
      { bangumiId: "3", tier: "high", lastIngestedAtMs: null },
    ],
    policy: POLICY,
  };
}

interface Recorder {
  ports: RunPorts;
  calls: () => string[];
  setOutcome: (o: RunWorkOutcome) => void;
}

function recorder(): Recorder {
  const calls: string[] = [];
  let outcome: RunWorkOutcome = { outcome: "ingested", version: 1 };
  const ports: RunPorts = {
    readRun: () => Promise.resolve(null),
    beginRun: () => { calls.push("begin"); return Promise.resolve(); },
    recordRun: () => { calls.push("record"); return Promise.resolve(); },
    ingestWork: (bangumiId, _tier, budget) => { calls.push("ingest:" + bangumiId); spendRequests(budget, 2); return Promise.resolve(outcome); },
    cleanup: () => { calls.push("cleanup"); return Promise.resolve(0); },
  };
  return { ports, calls: () => calls, setOutcome: (o) => { outcome = o; } };
}

describe("Daily run protocol — idempotency (AC1)", () => {
  it("returns a completed run unchanged on retry (idempotent no-op)", async () => {
    let stored: RunSnapshot | null = null;
    const rec = recorder();
    rec.ports.recordRun = (_id, snapshot) => { rec.calls().push("record"); stored = snapshot; return Promise.resolve(); };
    rec.ports.readRun = () => Promise.resolve(stored);
    await runDailyIngestWith(rec.ports, plan("daily-1"));
    const firstRuns = rec.calls().filter((c) => c.startsWith("ingest:")).length;
    await runDailyIngestWith(rec.ports, plan("daily-1"));
    expect(rec.calls().filter((c) => c.startsWith("ingest:")).length).toBe(firstRuns);
  });

  it("records a complete status and a publish version per work on success", async () => {
    const rec = recorder();
    const snapshot = await runDailyIngestWith(rec.ports, plan("daily-ok"));
    expect(snapshot.status).toBe("complete");
    expect(snapshot.published).toEqual({ "1": 1, "2": 1, "3": 1 });
    expect(rec.calls()).toContain("record");
    expect(rec.calls()).toContain("cleanup");
  });

  it("marks a run partial when some works succeed and others fail", async () => {
    const rec = recorder();
    const outcomes: RunWorkOutcome[] = [
      { outcome: "ingested", version: 4 },
      { outcome: "pipelineFailed", stage: "enrich", reason: "boom" },
      { outcome: "ingested", version: 5 },
    ];
    let n = 0;
    rec.ports.ingestWork = (bangumiId) => {
      rec.calls().push("ingest:" + bangumiId);
      const next = outcomes[n];
      n += 1;
      return Promise.resolve(next ?? { outcome: "pipelineFailed", stage: "enrich", reason: "none" });
    };
    const snapshot = await runDailyIngestWith(rec.ports, plan("daily-partial"));
    expect(snapshot.status).toBe("partial");
    expect(snapshot.failures).toEqual([{ bangumiId: "2", stage: "enrich", reason: "boom" }]);
    expect(snapshot.published).toEqual({ "1": 4, "3": 5 });
  });

  it("marks a run failed when no work publishes and never advances a pointer", async () => {
    const rec = recorder();
    rec.setOutcome({ outcome: "fetchFailed", source: "bangumi", reason: "500" });
    const snapshot = await runDailyIngestWith(rec.ports, plan("daily-fail"));
    expect(snapshot.status).toBe("failed");
    expect(Object.keys(snapshot.published)).toHaveLength(0);
  });

});

describe("Daily run protocol — clean budget stop (AC1)", () => {
  it("stops cleanly at the work budget and records the partial state", async () => {
    const rec = recorder();
    const tinyPolicy: RunPolicy = { ...POLICY, budget: { workLimit: 3, requestLimit: 2, runtimeLimitMs: 600000 } };
    const snapshot = await runDailyIngestWith(rec.ports, { ...plan("daily-budget"), policy: tinyPolicy });
    expect(snapshot.status).toBe("partial");
    expect(snapshot.firstExhausted).toBe("request");
    expect(Object.keys(snapshot.published).length).toBe(1);
  });
});

describe("Daily run protocol — per-source outcomes (AC1)", () => {
  it("tallies bangumi ok and anitabi empty on an empty result", async () => {
    const rec = recorder();
    rec.setOutcome({ outcome: "empty", source: "anitabi", reason: "no points" });
    const snapshot = await runDailyIngestWith(rec.ports, plan("daily-empty"));
    expect(snapshot.sources.bangumi?.ok).toBe(3);
    expect(snapshot.sources.anitabi?.empty).toBe(3);
  });

  it("tallies a bangumi fetch failure without publishing that work", async () => {
    const rec = recorder();
    rec.setOutcome({ outcome: "fetchFailed", source: "bangumi", reason: "upstream 500" });
    const snapshot = await runDailyIngestWith(rec.ports, plan("daily-fetch"));
    expect(snapshot.sources.bangumi?.failed).toBe(3);
    expect(Object.keys(snapshot.published).length).toBe(0);
  });
});
