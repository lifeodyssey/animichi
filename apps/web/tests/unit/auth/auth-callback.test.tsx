/**
 * @vitest-environment jsdom
 */
import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthCallback } from "../../../src/components/auth/AuthCallback";
import { renderWithLocale, setLanguages } from "../_i18n";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AuthCallback — dual intent (#480 P1-2)", () => {
  it("navigates to the return target after a successful deferred-save replay", async () => {
    const establish = vi.fn().mockResolvedValue("jwt-1");
    const replay = vi.fn().mockResolvedValue("saved" as const);
    const onDone = vi.fn();
    renderWithLocale(<AuthCallback establish={establish} replay={replay} onDone={onDone} hasReturnIntent />);
    await waitFor(() => { expect(onDone).toHaveBeenCalledTimes(1); });
    expect(replay).toHaveBeenCalledTimes(1);
  });

  it("still navigates when the replay failed but a return intent is waiting", async () => {
    const establish = vi.fn().mockResolvedValue("jwt-1");
    const replay = vi.fn().mockResolvedValue("failed" as const);
    const onDone = vi.fn();
    renderWithLocale(<AuthCallback establish={establish} replay={replay} onDone={onDone} hasReturnIntent />);
    await waitFor(() => { expect(onDone).toHaveBeenCalledTimes(1); });
  });

  it("keeps the blocking retry surface for a failed replay with no return intent", async () => {
    const establish = vi.fn().mockResolvedValue("jwt-1");
    const replay = vi.fn().mockResolvedValue("failed" as const);
    const onDone = vi.fn();
    renderWithLocale(<AuthCallback establish={establish} replay={replay} onDone={onDone} />);
    await waitFor(() => { expect(screen.getByRole("alert")).toBeTruthy(); });
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe("AuthCallback", () => {
  it("calls onDone once the session is established", async () => {
    const establish = vi.fn().mockResolvedValue("jwt-1");
    const onDone = vi.fn();
    renderWithLocale(<AuthCallback establish={establish} onDone={onDone} />);
    await waitFor(() => { expect(onDone).toHaveBeenCalledTimes(1); });
  });

  it("shows an on-brand error and never calls onDone when sign-in failed", async () => {
    setLanguages(["ja"]);
    const establish = vi.fn().mockResolvedValue(undefined);
    const onDone = vi.fn();
    renderWithLocale(<AuthCallback establish={establish} onDone={onDone} />);
    await waitFor(() => { expect(screen.getByRole("alert")).toBeTruthy(); });
    expect(onDone).not.toHaveBeenCalled();
  });
});
