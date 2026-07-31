/**
 * @vitest-environment jsdom
 */
import { expect, it, vi } from "vitest";
import { replayDeferredSave } from "../../../src/features/chat/save/createOnLogin";

it("reports a failed replay when the localStorage getter is blocked", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const getter = vi.spyOn(globalThis, "localStorage", "get").mockImplementation(() => {
    throw new DOMException("blocked", "SecurityError");
  });
  const request = vi.fn();
  try {
    expect(await replayDeferredSave(request, 1_000)).toBe("failed");
    expect(request).not.toHaveBeenCalled();
  } finally {
    getter.mockRestore();
  }
  expect(Object.getOwnPropertyDescriptor(globalThis, "localStorage")).toEqual(descriptor);
});
