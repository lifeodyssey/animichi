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
