/** The recording WorkPointsPort double and its canonical rows, shared by the
 * work-points suites (behaviour + logging). Named for what it builds, per
 * .claude/rules/naming-ownership.md. */
import type { WorkPointsPort } from "../src/api/work-points";
import type {
  IngestClaim,
  IngestGuard,
  IngestReadOutcome,
  IngestResult,
} from "../src/ingest/ingest-bangumi";
import type { Point } from "../src/types";
import type { PublishedPointRow } from "../src/application/list-points-for-bangumi";

export const PREVIEW: Point = {
  id: "lite-1",
  name: "宇治橋",
  bangumi_id: "115908",
  screenshot_url: "https://image.anitabi.cn/lite-1.jpg",
  latitude: 34.8915,
  longitude: 135.8078,
};

export const PUBLISHED: PublishedPointRow = {
  id: "published-1",
  name: "宇治橋",
  name_cn: null,
  bangumi_id: "115908",
  episode: 1,
  time_seconds: 120,
  image: "published.jpg",
  latitude: 34.8915,
  longitude: 135.8078,
  title: "響け！ユーフォニアム",
  title_cn: null,
  cover_url: null,
  synced_at: "2026-07-17T00:00:00.000Z",
};

interface RecorderState {
  rows?: PublishedPointRow[];
  rowsSequence: PublishedPointRow[][];
  guard: IngestGuard;
  claim?: IngestClaim;
  ingest?: Promise<IngestResult>;
  previews: string[];
  claims: string[];
  ingests: string[];
  completed: string[];
}

function recorderState(options: Partial<RecorderState> = {}): RecorderState {
  return { ...options, previews: [], claims: [], ingests: [], completed: [], guard: options.guard ?? "ready", rowsSequence: [...(options.rowsSequence ?? [])] };
}

export function fakeDb(options: Partial<RecorderState> = {}) {
  const state = recorderState(options);
  return { db: fakeDbMethods(state), ...state };
}

function fakeDbMethods(state: RecorderState): WorkPointsPort {
  return {
    pointsForBangumi: () => Promise.resolve(state.rowsSequence.shift() ?? state.rows ?? []),
    previewForWork: (bangumiId) => {
      state.previews.push(bangumiId);
      return Promise.resolve({ bangumiId, points: [PREVIEW] });
    },
    ingest: {
      guard: () => Promise.resolve(state.guard),
      readClaim: (bangumiId) => readClaimWork(state, bangumiId),
      claim: (bangumiId) => claimWork(state, bangumiId),
      markDone: (bangumiId) => {
        state.completed.push(bangumiId);
        return Promise.resolve();
      },
      runClaimed: (bangumiId) => {
        state.ingests.push(bangumiId);
        return state.ingest ?? Promise.resolve({ status: "ingested", version: 1, pointCount: 1 });
      },
    },
  };
}

function claimWork(state: RecorderState, bangumiId: string): Promise<IngestClaim> {
  state.claims.push(bangumiId);
  const claim: IngestClaim = state.claim ?? (state.guard === "ready" ? "acquired" : state.guard);
  if (claim === "acquired") state.guard = "in_progress";
  return Promise.resolve(claim);
}

/** Mirror of IngestBangumi.readClaim over the fake's guard/claim state. */
async function readClaimWork(state: RecorderState, bangumiId: string): Promise<IngestReadOutcome> {
  const guard = await Promise.resolve(state.guard);
  if (guard === "empty") return { kind: "empty" };
  if (guard !== "ready") return { kind: "syncing" };
  const claim = await claimWork(state, bangumiId);
  if (claim === "empty") return { kind: "empty" };
  return claim === "acquired" ? { kind: "acquired" } : { kind: "syncing" };
}

export function waitUntilSpy(): { waitUntil: (promise: Promise<unknown>) => void; scheduled: Promise<unknown>[] } {
  const scheduled: Promise<unknown>[] = [];
  return { waitUntil: (promise) => void scheduled.push(promise), scheduled };
}
