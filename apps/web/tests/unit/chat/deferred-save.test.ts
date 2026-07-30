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
  vi.restoreAllMocks();
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

  it("treats a malformed entry as absent AND erases it", async () => {
    localStorage.setItem(DEFERRED_SAVE_KEY, '{"pointIds":"nope"}');
    const request = vi.fn();
    expect(await replayDeferredSave(request, 1_000)).toBe("none");
    expect(request).not.toHaveBeenCalled();
    expect(localStorage.getItem(DEFERRED_SAVE_KEY)).toBeNull();
  });

  it("treats unparseable JSON as absent, erasing it rather than throwing", () => {
    localStorage.setItem(DEFERRED_SAVE_KEY, "{not json");
    expect(readDeferredSave(1_000)).toBeUndefined();
    expect(localStorage.getItem(DEFERRED_SAVE_KEY)).toBeNull();
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

describe("S1 hardening: storage method failures do not escape", () => {
  it("does not throw when setItem is blocked at call time", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(() => {
      writeDeferredSave(INTENT, 1_000);
    }).not.toThrow();
  });

  it("reads no intent but reports a failed claim when getItem is blocked", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(readDeferredSave(1_000)).toBeUndefined();
    const request = vi.fn();
    expect(await replayDeferredSave(request, 1_000)).toBe("failed");
    expect(request).not.toHaveBeenCalled();
  });

  it("does not throw when removeItem is blocked at call time", () => {
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(clearDeferredSave).not.toThrow();
  });

  it("does not replay a live intent when claiming it is blocked", async () => {
    writeDeferredSave(INTENT, 1_000);
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    const request = vi.fn().mockResolvedValue({ id: "r1" });
    expect(await replayDeferredSave(request, 1_100)).toBe("failed");
    expect(request).not.toHaveBeenCalled();
  });

  it("returns no malformed intent when cleanup is blocked", () => {
    localStorage.setItem(DEFERRED_SAVE_KEY, "{not json");
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(readDeferredSave(1_000)).toBeUndefined();
  });

  it("returns no expired intent when cleanup is blocked", () => {
    writeDeferredSave(INTENT, 1_000);
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(readDeferredSave(1_000 + DEFERRED_SAVE_TTL_MS + 1)).toBeUndefined();
  });
});

describe("AC4 negative: a login not initiated by a save tap replays nothing", () => {
  it("makes no saveRoute call when no intent is present", async () => {
    const request = vi.fn();
    expect(await replayDeferredSave(request, 1_000)).toBe("none");
    expect(request).not.toHaveBeenCalled();
  });

  it("makes no saveRoute call when the only intent has expired", async () => {
    writeDeferredSave(INTENT, 1_000);
    const request = vi.fn();
    expect(await replayDeferredSave(request, 1_000 + DEFERRED_SAVE_TTL_MS + 1)).toBe("none");
    expect(request).not.toHaveBeenCalled();
  });
});

describe("P2-2: an unrelated login inside the TTL still completes the user's own save", () => {
  it("replays a live intent even though this login was not the one that stashed it", async () => {
    writeDeferredSave(INTENT, 1_000);
    const request = vi.fn().mockResolvedValue({ id: "r1" });
    // Ruled semantics: an intent can only be produced by a real 保存する tap, so
    // replaying it within the TTL finishes a save the same user asked for. This
    // test pins that intent so a later refactor cannot drift it silently.
    expect(await replayDeferredSave(request, 1_000 + 60_000)).toBe("saved");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("consumes the intent, so a second unrelated login replays nothing", async () => {
    writeDeferredSave(INTENT, 1_000);
    const request = vi.fn().mockResolvedValue({ id: "r1" });
    await replayDeferredSave(request, 1_100);
    expect(await replayDeferredSave(request, 1_200)).toBe("none");
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe("P2-3: two tabs completing a login concurrently save once", () => {
  it("claims the intent before sending, so the second replay finds nothing", async () => {
    writeDeferredSave(INTENT, 1_000);
    const request = vi.fn().mockResolvedValue({ id: "r1" });
    const outcomes = await Promise.all([replayDeferredSave(request, 1_100), replayDeferredSave(request, 1_100)]);
    expect(request).toHaveBeenCalledTimes(1);
    expect(outcomes.filter((outcome) => outcome === "saved")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === "none")).toHaveLength(1);
  });

  it("restores a failed claim with its original timestamp, never extending the TTL", async () => {
    writeDeferredSave(INTENT, 1_000);
    const request = vi.fn().mockRejectedValue(new Error("502"));
    await replayDeferredSave(request, 1_100);
    expect(readDeferredSave(1_100)?.createdAt).toBe(1_000);
    expect(readDeferredSave(1_000 + DEFERRED_SAVE_TTL_MS + 1)).toBeUndefined();
  });
});

describe("AC3/AC7: replay semantics", () => {
  it("saves the exact deferred ids in order and clears the intent on success", async () => {
    writeDeferredSave(INTENT, 1_000);
    const request = vi.fn().mockResolvedValue({ id: "r1" });
    expect(await replayDeferredSave(request, 1_100)).toBe("saved");
    expect(request).toHaveBeenCalledWith({ title: INTENT.title, point_ids: ["p1", "p2"], status: "saved" });
    expect(localStorage.getItem(DEFERRED_SAVE_KEY)).toBeNull();
  });

  it("keeps the intent after a failed replay so it is not silently dropped", async () => {
    writeDeferredSave(INTENT, 1_000);
    const request = vi.fn().mockRejectedValue(new Error("502"));
    expect(await replayDeferredSave(request, 1_100)).toBe("failed");
    expect(readDeferredSave(1_100)).toBeDefined();
  });
});
