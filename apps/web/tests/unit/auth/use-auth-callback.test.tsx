/**
 * @vitest-environment jsdom
 */
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useAuthCallback } from "../../../src/components/auth/useAuthCallback";

describe("useAuthCallback", () => {
  it("starts pending, then resolves to done once a token is established", async () => {
    const establish = vi.fn().mockResolvedValue("jwt-1");
    const view = renderHook(() => useAuthCallback(establish));
    expect(view.result.current.state).toBe("pending");
    await waitFor(() => { expect(view.result.current.state).toBe("done"); });
  });

  it("resolves to error when no token could be established", async () => {
    const establish = vi.fn().mockResolvedValue(undefined);
    const view = renderHook(() => useAuthCallback(establish));
    await waitFor(() => { expect(view.result.current.state).toBe("error"); });
  });

  it("ignores a late resolution after unmount", async () => {
    let resolve!: (token: string | undefined) => void;
    const establish = vi.fn(() => new Promise<string | undefined>((r) => { resolve = r; }));
    const view = renderHook(() => useAuthCallback(establish));
    view.unmount();
    resolve("jwt-late");
    await new Promise((r) => setTimeout(r, 10));
    expect(view.result.current.state).toBe("pending");
  });
});
