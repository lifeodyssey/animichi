import type { SaveSavedRouteInput, SavedRoute } from "@animichi/contract";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { NeonAtomicCommitStore } from "../src/adapters/neon-atomic-commit";
import { NeonIdempotencyStore } from "../src/adapters/neon-idempotency-store";
import { saveSavedRouteIdempotent, type AtomicCommitStore } from "../src/application/save-saved-route-idempotent";
import { instantPause } from "./instant-pause";
import { databaseDescribe, emptySavedRoutes, openUsersPrisma, type UsersSeam } from "./integration-db";

/**
 * SUT: `saveSavedRouteIdempotent` when a second save under the same key finds
 * the first save's claim still in flight (N6), against real Postgres. Each save
 * runs on its own runtime — its own connection, as each Worker request has — so
 * the second can only see what the first has committed.
 *
 * The first save is held at the start of its transaction, after it has claimed
 * the key, until the second save pauses. The second save's pause is injected: it
 * records the duration it was asked for, lets the first save go on and resumes
 * once the first has settled. No real time passes, and the recorded durations
 * are the production wait's interval and bound.
 */
/** A fixed past instant, so the claim's database-assigned created_at reads as in flight. */
const NOW = 1_752_933_600_000;
const KEY = "same-key";
const INPUT: SaveSavedRouteInput = { title: "Tokyo", point_ids: ["p1", "p2"], status: "saved" };
/** Eight pauses of 250 ms: the 2 s the wait gives the claim holder before it answers. */
const FULL_WAIT = [250, 250, 250, 250, 250, 250, 250, 250];

let first: UsersSeam;
let second: UsersSeam;

beforeAll(async () => {
  first = await openUsersPrisma();
  second = await openUsersPrisma();
});

afterAll(async () => {
  await first.dispose();
  await second.dispose();
});

beforeEach(async () => {
  await emptySavedRoutes(first.prisma);
});

/** A one-shot signal: opened once, awaited anywhere. */
interface Signal {
  readonly opened: Promise<void>;
  readonly open: () => void;
}

function signal(): Signal {
  let open = (): void => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

/** The first save's commit store: it signals once the first save holds the
 * claim, then runs `commit` (the real transaction, or a failure) on release. */
interface HeldCommit {
  readonly store: AtomicCommitStore;
  readonly claimed: Promise<void>;
  readonly release: () => void;
}

function heldCommit(commit: AtomicCommitStore["insertRouteAndCommit"]): HeldCommit {
  const claimed = signal();
  const released = signal();
  const store: AtomicCommitStore = {
    insertRouteAndCommit: async (params) => {
      claimed.open();
      await released.opened;
      return commit(params);
    },
  };
  return { store, claimed: claimed.opened, release: released.open };
}

/** The second save's pause: it records the duration asked for, releases the
 * first save and resumes once the first save has settled, either way. */
function pauseReleasing(held: HeldCommit, firstSettled: Promise<unknown>) {
  const asked: number[] = [];
  const sleep = async (ms: number): Promise<void> => {
    asked.push(ms);
    held.release();
    await firstSettled;
  };
  return { asked, sleep };
}

function save(seam: UsersSeam, atomicStore: AtomicCommitStore, sleep: (ms: number) => Promise<void>): Promise<SavedRoute> {
  return saveSavedRouteIdempotent(
    atomicStore, new NeonIdempotencyStore(seam.prisma), "user-a", INPUT, KEY, { now: () => NOW, sleep },
  );
}

async function countRoutes(): Promise<number> {
  return (await first.prisma.executor.query(first.prisma.builder.public.saved_routes.select("id").build())).length;
}

databaseDescribe("a duplicate save waits for the claim holder's commit (N6)", () => {
  it("returns the first save's route once it commits inside the bound, never a 409", async () => {
    const held = heldCommit((params) => new NeonAtomicCommitStore(first.prisma).insertRouteAndCommit(params));
    const firstSave = save(first, held.store, instantPause);
    const firstSettled = Promise.allSettled([firstSave]);
    await held.claimed;
    const pause = pauseReleasing(held, firstSettled);
    const secondRoute = await save(second, new NeonAtomicCommitStore(second.prisma), pause.sleep);
    expect(secondRoute).toEqual(await firstSave);
    expect(pause.asked).toEqual([250]);
    expect(await countRoutes()).toBe(1);
  });

  it("answers the retryable IDEMPOTENCY_IN_FLIGHT at the bound when the first save fails", async () => {
    const held = heldCommit(() => Promise.reject(new Error("the first save lost its connection")));
    const firstSave = save(first, held.store, instantPause);
    const firstSettled = Promise.allSettled([firstSave]);
    await held.claimed;
    const pause = pauseReleasing(held, firstSettled);
    await expect(save(second, new NeonAtomicCommitStore(second.prisma), pause.sleep))
      .rejects.toMatchObject({ code: "IDEMPOTENCY_IN_FLIGHT", status: 409 });
    expect(pause.asked).toEqual(FULL_WAIT);
    await expect(firstSave).rejects.toThrow("the first save lost its connection");
    expect(await countRoutes()).toBe(0);
  });
});
