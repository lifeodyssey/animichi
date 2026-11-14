import { describe, expect, it } from "vitest";
import {
  runDailyIngestWith, type RunFailure, type RunLedgerEntry, type RunPlan, type RunPolicy, type RunSnapshot, type RunStatus,
  type RunWorkOutcome,
} from "../src/ingest/daily-run";
import { canSpendWork, spendRequests, spendWork } from "../src/ingest/budgets";
import type { RunPorts } from "../src/ingest/daily-run";

const POLICY: RunPolicy = {
  staleRunningMs: 15 * 60_000,
  tierIntervals: { high: 86400000, medium: 604800000, low: 2592000000 },
  newWorkCap: 5,
  keepHistory: 2,
  budget: { workLimit: 10, requestLimit: 20, runtimeLimitMs: 600000 },
};

const DATA_EPOCH = 1723000000000;

function plan(runId: string, budgetRequestLimit = 20): RunPlan {
  return {
    runId,
    epochMs: DATA_EPOCH,
    discovery: [{ source: "current_season" as const, bangumiIds: ["1", "2", "3"] }],
    knownIds: new Set(),
    tiered: [
      { bangumiId: "1", tier: "high", lastIngestedAtMs: null },
      { bangumiId: "2", tier: "high", lastIngestedAtMs: null },
      { bangumiId: "3", tier: "high", lastIngestedAtMs: null },
    ],
    policy: { ...POLICY, budget: { workLimit: 10, requestLimit: budgetRequestLimit, runtimeLimitMs: 600000 } },
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

describe("Budget boundary stops cleanly (AC3)", () => {
  it("records the run when a work's cost no longer fits the remaining budget", async () => {
    const rec = recorder();
    rec.ports.ingestWork = (_bangumiId, _tier, budget) => {
      if (!canSpendWork(budget)) return Promise.resolve({ outcome: "exhausted" });
      spendWork(budget, 2, 0);
      return Promise.resolve({ outcome: "ingested", version: 1 });
    };
    const snapshot = await runDailyIngestWith(rec.ports, plan("daily-boundary", 3));
    expect(snapshot.status).toBe("partial");
    expect(snapshot.firstExhausted).toBe("request");
    expect(Object.keys(snapshot.published).length).toBe(1);
    expect(rec.calls()).toContain("record");
    expect(rec.calls()).toContain("cleanup");
  });
});

describe("Concurrent reservation (AC1)", () => {
  it("skips without ingesting when another invocation already reserved the run", async () => {
    const rec = recorder();
    rec.ports.beginRun = () => Promise.resolve(false);
    const result = await runDailyIngestWith(rec.ports, plan("daily-race"));
    expect(result.status).toBe("running");
    expect(rec.calls().filter((c) => c.startsWith("ingest:")).length).toBe(0);
    expect(rec.calls()).not.toContain("record");
  });

  it("resumes a partial run by reserving it and re-ingesting the remainder", async () => {
    const rec = recorder();
    rec.ports.readRun = () => Promise.resolve(snapshot("partial", { published: { "1": 4 } }));
    const result = await runDailyIngestWith(rec.ports, plan("daily-resume-running"));
    expect(rec.calls()).toContain("begin");
    expect(rec.calls()).toContain("record");
    expect(rec.calls().filter((c) => c.startsWith("ingest:")).length).toBe(2);
    expect(result.status).toBe("complete");
  });
});

describe("Fetch-failure per-source tally (AC1)", () => {
  it("does not tally the never-fetched other source as ok", async () => {
    const rec = recorder();
    rec.setOutcome({ outcome: "fetchFailed", source: "bangumi", attempted: ["bangumi"], reason: "500" });
    const snapshot = await runDailyIngestWith(rec.ports, plan("daily-attempted"));
    expect(snapshot.sources.bangumi?.failed).toBe(3);
    expect(snapshot.sources.anitabi?.attempted).toBe(0);
    expect(snapshot.sources.anitabi?.ok).toBe(0);
  });

  it("tallies ok for a source that succeeded before the other failed", async () => {
    const rec = recorder();
    rec.setOutcome({ outcome: "fetchFailed", source: "anitabi", attempted: ["bangumi", "anitabi"], reason: "500" });
    const snapshot = await runDailyIngestWith(rec.ports, plan("daily-attempted-2"));
    expect(snapshot.sources.anitabi?.failed).toBe(3);
    expect(snapshot.sources.bangumi?.ok).toBe(3);
  });
});

const ENRICH_2: RunFailure = { bangumiId: "2", stage: "enrich", reason: "boom" };
const UNREAD: RunLedgerEntry = { unrecognised: { bangumiId: "9", stage: "publish", reason: "a stage this code does not write" } };

describe("Failure ledger across attempts", () => {
  it("a resumed run records an earlier attempt's failure and still completes", async () => {
    const rec = recorder();
    const recorded: RunSnapshot[] = [];
    rec.ports.readRun = () => Promise.resolve(snapshot("partial", { published: { "1": 4, "3": 5 }, failures: [ENRICH_2] }));
    rec.ports.recordRun = (_id, run) => { recorded.push(run); return Promise.resolve(); };
    await runDailyIngestWith(rec.ports, plan("daily-ledger-resume"));
    expect(recorded).toEqual([expect.objectContaining({ status: "complete", failures: [ENRICH_2] })]);
  });

  it("a resumed run records an entry it does not recognise unread, and completes on its own outcomes", async () => {
    const rec = recorder();
    const recorded: RunSnapshot[] = [];
    rec.ports.readRun = () => Promise.resolve(snapshot("partial", { published: { "1": 4, "3": 5 }, failures: [UNREAD] }));
    rec.ports.recordRun = (_id, run) => { recorded.push(run); return Promise.resolve(); };
    await runDailyIngestWith(rec.ports, plan("daily-ledger-unread"));
    expect(recorded).toEqual([expect.objectContaining({ status: "complete", failures: [UNREAD] })]);
  });

  it("a stale reclaim marks the run failed with its earlier entries and a reclaim entry naming no work", async () => {
    const rec = recorder();
    const marked: (readonly RunLedgerEntry[])[] = [];
    rec.ports.readRun = () => Promise.resolve(snapshot("running", { startedAtMs: DATA_EPOCH - 3_600_000, failures: [ENRICH_2] }));
    rec.ports.markRunFailed = (_id, failures) => { marked.push(failures); return Promise.resolve(); };
    await runDailyIngestWith(rec.ports, plan("daily-ledger-stale"));
    expect(marked).toEqual([[ENRICH_2, { stage: "reclaim", reason: "stale-reclaimed" }]]);
  });
});

type ExistingRun = Partial<Pick<RunSnapshot, "startedAtMs" | "published" | "failures">>;

function snapshot(status: RunStatus, overrides: ExistingRun = {}): RunSnapshot {
  return {
    status,
    targets: null,
    sources: { bangumi: { attempted: 0, ok: 0, failed: 0, empty: 0 }, anitabi: { attempted: 0, ok: 0, failed: 0, empty: 0 } },
    budgetUsed: { workUsed: 0, requestUsed: 0, runtimeUsedMs: 0 },
    firstExhausted: null,
    failures: overrides.failures ?? [],
    published: overrides.published ?? {},
    startedAtMs: overrides.startedAtMs ?? null,
  };
}
