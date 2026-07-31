/**
 * @vitest-environment jsdom
 */
import { afterEach, assert, expect, it, vi } from "vitest";
import {
  DEFERRED_SAVE_KEY,
  DEFERRED_SAVE_TTL_MS,
  writeDeferredSave,
} from "../../../src/features/chat/save/deferredSave";
import { replayDeferredSave } from "../../../src/features/chat/save/createOnLogin";

function localStorageDescriptor(): PropertyDescriptor {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  assert(descriptor !== undefined, "jsdom localStorage descriptor is missing");
  return descriptor;
}

const LOCAL_STORAGE_DESCRIPTOR = localStorageDescriptor();

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(globalThis, "localStorage", LOCAL_STORAGE_DESCRIPTOR);
  localStorage.clear();
});

it("reports a failed replay when the localStorage getter is blocked", async () => {
  const getter = vi.spyOn(globalThis, "localStorage", "get").mockImplementation(() => {
    throw new DOMException("blocked", "SecurityError");
  });
  const request = vi.fn();
  expect(await replayDeferredSave(request, 1_000)).toBe("failed");
  expect(request).not.toHaveBeenCalled();
  getter.mockRestore();
  expect(Object.getOwnPropertyDescriptor(globalThis, "localStorage")).toEqual(LOCAL_STORAGE_DESCRIPTOR);
  expect(() => globalThis.localStorage.getItem(DEFERRED_SAVE_KEY)).not.toThrow();
});

it("treats an SSR environment with no localStorage property as absent", async () => {
  expect(Reflect.deleteProperty(globalThis, "localStorage")).toBe(true);
  const request = vi.fn();
  expect(await replayDeferredSave(request, 1_000)).toBe("none");
  expect(request).not.toHaveBeenCalled();
});

it("treats malformed data as absent when best-effort cleanup is blocked", async () => {
  localStorage.setItem(DEFERRED_SAVE_KEY, "{not json");
  vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
    throw new DOMException("blocked", "SecurityError");
  });
  const request = vi.fn();
  expect(await replayDeferredSave(request, 1_000)).toBe("none");
  expect(request).not.toHaveBeenCalled();
  expect(localStorage.getItem(DEFERRED_SAVE_KEY)).toBe("{not json");
});

it("treats expired data as absent when best-effort cleanup is blocked", async () => {
  writeDeferredSave({ pointIds: ["p1"], title: "宇治" }, 1_000);
  vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
    throw new DOMException("blocked", "SecurityError");
  });
  const request = vi.fn();
  expect(await replayDeferredSave(request, 1_000 + DEFERRED_SAVE_TTL_MS + 1)).toBe("none");
  expect(request).not.toHaveBeenCalled();
  expect(localStorage.getItem(DEFERRED_SAVE_KEY)).not.toBeNull();
});
