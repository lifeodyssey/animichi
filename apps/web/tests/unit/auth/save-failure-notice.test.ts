/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SAVE_FAILURE_NOTICE_KEY,
  armSaveFailureNotice,
  consumeSaveFailureNotice,
} from "../../../src/lib/auth/save-failure-notice";

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe("save-failure notice", () => {
  it("is consumed at most once per arm", () => {
    armSaveFailureNotice();
    expect(consumeSaveFailureNotice()).toBe(true);
    expect(consumeSaveFailureNotice()).toBe(false);
  });

  it("stays silent when nothing armed it", () => {
    expect(consumeSaveFailureNotice()).toBe(false);
  });

  it("removes the key on consume, so a reload cannot resurrect the message", () => {
    armSaveFailureNotice();
    expect(consumeSaveFailureNotice()).toBe(true);
    expect(sessionStorage.getItem(SAVE_FAILURE_NOTICE_KEY)).toBeNull();
  });

  it("stays silent when storage access is blocked, rather than throwing", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(consumeSaveFailureNotice()).toBe(false);
  });

  it("does not throw when arming is blocked", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(() => { armSaveFailureNotice(); }).not.toThrow();
  });
});
