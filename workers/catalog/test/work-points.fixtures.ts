/** The recording WorkPointsPort double and its canonical rows, shared by the
 * work-points suites. Named for what it builds, per
 * .claude/rules/naming-ownership.md. */
import type { WorkPointsPort } from "../src/api/work-points";
import type { IngestGuard } from "../src/ingest/ingest-bangumi";
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
  guard: IngestGuard;
  previews: string[];
  parked: string[];
}

function recorderState(options: Partial<RecorderState> = {}): RecorderState {
  return { ...options, previews: [], parked: [], guard: options.guard ?? "ready" };
}

export function fakeDb(options: Partial<RecorderState> = {}) {
  const state = recorderState(options);
  return { db: fakeDbMethods(state), ...state };
}

function fakeDbMethods(state: RecorderState): WorkPointsPort {
  return {
    pointsForBangumi: () => Promise.resolve(state.rows ?? []),
    previewForWork: (bangumiId) => {
      state.previews.push(bangumiId);
      return Promise.resolve({ bangumiId, points: [PREVIEW] });
    },
    ingest: {
      guard: () => Promise.resolve(state.guard),
      ensurePending: (bangumiId) => {
        state.parked.push(bangumiId);
        return Promise.resolve();
      },
    },
  };
}
