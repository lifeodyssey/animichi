import { describe, expect, it, vi } from "vitest";
import { registerAnimeSw } from "../../../src/features/anime/register-sw";

describe("registerAnimeSw", () => {
  it("registers /sw.js when the navigator supports service workers", () => {
    const register = vi.fn(() => Promise.resolve({}));
    registerAnimeSw({ serviceWorker: { register } });
    expect(register).toHaveBeenCalledWith("/sw.js");
  });

  it("is a no-op when service workers are unsupported", () => {
    expect(() => {
      registerAnimeSw({});
    }).not.toThrow();
  });

  it("swallows registration failures instead of crashing the page", async () => {
    const register = vi.fn(() => Promise.reject(new Error("denied")));
    registerAnimeSw({ serviceWorker: { register } });
    await Promise.resolve();
    expect(register).toHaveBeenCalledWith("/sw.js");
  });
});
