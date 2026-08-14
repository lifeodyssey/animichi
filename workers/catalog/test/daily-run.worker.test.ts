import { describe, expect, it } from "vitest";
import { runDailyIngestWith, type RunPlan, type RunPorts, type RunPolicy, type RunSnapshot, type RunStatus, type RunWorkOutcome } from "../src/ingest/daily-run";
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
    beginRun: () => { calls.push("begin"); return Promise.resolve(true); },
    recordRun: () => { calls.push("record"); return Promise.resolve(); },
    ingestWork: (bangumiId, _tier, budget) => { calls.push("ingest:" + bangumiId); spendRequests(budget, 2); return Promise.resolve(outcome); },
    cleanup: () => { calls.push("cleanup"); return Promise.resolve(0); },
    markRunFailed: () => { calls.push("reclaim"); return Promise.resolve(); },
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
    rec.setOutcome({ outcome: "fetchFailed", source: "bangumi", attempted: ["bangumi"], reason: "500" });
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
    rec.setOutcome({ outcome: "fetchFailed", source: "bangumi", attempted: ["bangumi"], reason: "upstream 500" });
    const snapshot = await runDailyIngestWith(rec.ports, plan("daily-fetch"));
    expect(snapshot.sources.bangumi?.failed).toBe(3);
    expect(Object.keys(snapshot.published).length).toBe(0);
  });
});
describe("Daily run protocol — stale running reclaim (MAJOR-2)", () => {
  it("reclaims a stale running run before re-running it", async () => {
    const rec = recorder();
    const staleStarted = DATA_EPOCH - 10 * 60 * 60 * 1000; // older than the 15 min threshold
    rec.ports.readRun = () => Promise.resolve(snapshot("running", { startedAtMs: staleStarted }));
    const result = await runDailyIngestWith(rec.ports, plan("daily-reclaim"));
    expect(rec.calls()).toContain("reclaim");
    expect(rec.calls()).toContain("begin");
    expect(rec.calls().filter((c) => c.startsWith("ingest:")).length).toBe(3);
    expect(result.status).toBe("complete");
  });

  it("does not reclaim or re-run an in-flight non-stale running run", async () => {
    const rec = recorder();
    const recentStarted = DATA_EPOCH - 1000;
    const existing = snapshot("running", { startedAtMs: recentStarted });
    rec.ports.readRun = () => Promise.resolve(existing);
    const result = await runDailyIngestWith(rec.ports, plan("daily-inflight"));
    expect(rec.calls()).not.toContain("reclaim");
    expect(rec.calls().filter((c) => c.startsWith("ingest:")).length).toBe(0);
    expect(result).toBe(existing);
  });
});

describe("Daily run protocol — partial/failed resume is idempotent (MAJOR-2)", () => {
  it("skips already-published works and re-ingests only the remainder", async () => {
    const rec = recorder();
    rec.ports.readRun = () => Promise.resolve(snapshot("partial", { published: { "1": 4, "2": 5 } }));
    const result = await runDailyIngestWith(rec.ports, plan("daily-resume"));
    const ingested = rec.calls().filter((c) => c.startsWith("ingest:")).map((c) => c.slice("ingest:".length));
    expect(ingested).toEqual(["3"]);
    // Retained versions stay; work 3 publishes at the recorder default version 1.
    expect(result.published).toEqual({ "1": 4, "2": 5, "3": 1 });
    expect(result.status).toBe("complete");
  });

  it("does not re-run anything when every due work is already published", async () => {
    const rec = recorder();
    rec.ports.readRun = () => Promise.resolve(snapshot("failed", { published: { "1": 1, "2": 2, "3": 3 } }));
    const result = await runDailyIngestWith(rec.ports, plan("daily-all-done"));
    expect(rec.calls().filter((c) => c.startsWith("ingest:")).length).toBe(0);
    expect(result.status).toBe("complete");
  });
});

/** DATA_EPOCH matches the shared run plan clock. */
const DATA_EPOCH = 1723000000000;

/** Build a minimal existing-run snapshot for the read gate. */
function snapshot(status: RunStatus, overrides: Partial<Pick<RunSnapshot, "startedAtMs" | "published">> = {}): RunSnapshot {
  return {
    status,
    targets: null,
    sources: { bangumi: { attempted: 0, ok: 0, failed: 0, empty: 0 }, anitabi: { attempted: 0, ok: 0, failed: 0, empty: 0 } },
    budgetUsed: { workUsed: 0, requestUsed: 0, runtimeUsedMs: 0 },
    firstExhausted: null,
    failures: [],
    published: overrides.published ?? {},
    startedAtMs: overrides.startedAtMs ?? null,
  };
}
