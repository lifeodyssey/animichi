import type { JobClaim, JobStore } from "../../src/ingest/jobs";

/** A claim as a store hands it to the singleflight winner, under a fixed `started_at` stamp. */
export function claimOn(workId: string): JobClaim {
  return { workId, startedAt: "2026-11-14 00:00:00+00" };
}

/** The claim an acquire the test's premise says must win; losing it rejects, failing the test there. */
export async function acquired(store: JobStore, workId: string): Promise<JobClaim> {
  return (await store.acquire(workId)) ?? Promise.reject(new Error(`expected to acquire the claim on ${workId}`));
}
