/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFERRED_SAVE_KEY,
  DEFERRED_SAVE_TTL_MS,
  clearDeferredSave,
  readDeferredSave,
  writeDeferredSave,
} from "../../../src/features/chat/save/deferredSave";
import { replayDeferredSave } from "../../../src/features/chat/save/createOnLogin";

afterEach(() => {
  localStorage.clear();
});

const INTENT = { pointIds: ["p1", "p2"], title: "宇治・2スポット" } as const;

describe("AC4: the deferred intent lives in namespaced localStorage", () => {
  it("writes under a namespaced key so it survives a new browsing context", () => {
    writeDeferredSave(INTENT, 1_000);
    expect(DEFERRED_SAVE_KEY).toContain("animichi");
    expect(localStorage.getItem(DEFERRED_SAVE_KEY)).toBeTruthy();
    expect(sessionStorage.getItem(DEFERRED_SAVE_KEY)).toBeNull();
  });

  it("round-trips the point ids in order plus the derived title", () => {
    writeDeferredSave(INTENT, 1_000);
    expect(readDeferredSave(1_000)).toEqual({ ...INTENT, createdAt: 1_000 });
  });

  it("carries no session id — the magic-link tab never inherits one", () => {
    writeDeferredSave(INTENT, 1_000);
    expect(localStorage.getItem(DEFERRED_SAVE_KEY)).not.toContain("session");
  });

  it("reads nothing when no save tap ever wrote an intent", () => {
    expect(readDeferredSave(1_000)).toBeUndefined();
  });

  it("treats a malformed entry as absent rather than replaying garbage", () => {
    localStorage.setItem(DEFERRED_SAVE_KEY, '{"pointIds":"nope"}');
    expect(readDeferredSave(1_000)).toBeUndefined();
  });

  it("treats unparseable JSON as absent rather than throwing", () => {
    localStorage.setItem(DEFERRED_SAVE_KEY, "{not json");
    expect(readDeferredSave(1_000)).toBeUndefined();
  });

  it("clears the entry on demand", () => {
    writeDeferredSave(INTENT, 1_000);
    clearDeferredSave();
    expect(localStorage.getItem(DEFERRED_SAVE_KEY)).toBeNull();
  });
});

describe("AC5: an intent older than the TTL is ignored and cleared", () => {
  it("replays an intent that is still inside the TTL window", () => {
    writeDeferredSave(INTENT, 1_000);
    expect(readDeferredSave(1_000 + DEFERRED_SAVE_TTL_MS - 1)).toBeDefined();
  });

  it("ignores and erases an abandoned intent past the TTL", () => {
    writeDeferredSave(INTENT, 1_000);
    expect(readDeferredSave(1_000 + DEFERRED_SAVE_TTL_MS + 1)).toBeUndefined();
    expect(localStorage.getItem(DEFERRED_SAVE_KEY)).toBeNull();
  });
});

describe("AC4 negative: a login not initiated by a save tap replays nothing", () => {
  it("makes no saveRoute call when no intent is present", async () => {
    const request = vi.fn();
    expect(await replayDeferredSave(request, 1_000)).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });

  it("makes no saveRoute call when the only intent has expired", async () => {
    writeDeferredSave(INTENT, 1_000);
    const request = vi.fn();
    expect(await replayDeferredSave(request, 1_000 + DEFERRED_SAVE_TTL_MS + 1)).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });
});

describe("AC3/AC7: replay semantics", () => {
  it("saves the exact deferred ids in order and clears the intent on success", async () => {
    writeDeferredSave(INTENT, 1_000);
    const request = vi.fn().mockResolvedValue({ id: "r1" });
    expect(await replayDeferredSave(request, 1_100)).toBe(true);
    expect(request).toHaveBeenCalledWith({ title: INTENT.title, point_ids: ["p1", "p2"], status: "saved" });
    expect(localStorage.getItem(DEFERRED_SAVE_KEY)).toBeNull();
  });

  it("keeps the intent after a failed replay so it is not silently dropped", async () => {
    writeDeferredSave(INTENT, 1_000);
    const request = vi.fn().mockRejectedValue(new Error("502"));
    expect(await replayDeferredSave(request, 1_100)).toBe(false);
    expect(readDeferredSave(1_100)).toBeDefined();
  });
});
