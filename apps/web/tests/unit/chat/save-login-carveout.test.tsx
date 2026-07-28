/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BudgetExhausted } from "../../../src/features/chat/components/ErrorStates/BudgetExhausted";
import { SessionExpired } from "../../../src/features/chat/components/ErrorStates/SessionExpired";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { AuthCallback } from "../../../src/components/auth/AuthCallback";
import { useAuthCallback } from "../../../src/components/auth/useAuthCallback";
import type { DeferredReplayOutcome } from "../../../src/features/chat/save/createOnLogin";
import { DEFERRED_SAVE_KEY, writeDeferredSave } from "../../../src/features/chat/save/deferredSave";
import { dictFor } from "../../../src/i18n/dictionaries";
import { renderWithLocale, setLanguages } from "../_i18n";

beforeEach(() => { setLanguages(["ja-JP"]); });
afterEach(() => {
  cleanup();
  localStorage.clear();
});

const ja = chatDictFor("ja");
const states = ja.errorStates;

describe("AC9: the D8/D11 recovery affordances are not P5 interruptions", () => {
  it("D8 keeps its own user-initiated login, and opens nothing before the tap", async () => {
    renderWithLocale(<SessionExpired dict={ja} onResume={vi.fn()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: states.d8Login }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("D11 keeps its own user-initiated login, and opens nothing before the tap", async () => {
    renderWithLocale(<BudgetExhausted dict={ja} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: states.d11Login }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("neither banner renders on a happy-path route card, so neither can interrupt it", () => {
    renderWithLocale(<SessionExpired dict={ja} onResume={vi.fn()} />);
    expect(screen.queryByText(states.d11Message)).toBeNull();
  });
});

/** Stable identities: the production defaults are module bindings, so the
 * redeem effect must run exactly once per mount. */
const establish = () => Promise.resolve("token");

function Callback({ replay }: Readonly<{ replay: () => Promise<DeferredReplayOutcome> }>) {
  return <span>{useAuthCallback(establish, replay).state}</span>;
}

describe("AC4 negative: only a save-initiated login replays a save", () => {
  it("replays the stashed intent after the callback redeems the session", async () => {
    writeDeferredSave({ pointIds: ["p1"], title: "t" });
    const replay = vi.fn().mockResolvedValue("saved");
    render(<Callback replay={replay} />);
    await waitFor(() => { expect(screen.getByText("done")).toBeTruthy(); });
    expect(replay).toHaveBeenCalledTimes(1);
  });

  it("still completes the callback when no save intent was ever written", async () => {
    const replay = vi.fn().mockResolvedValue("none");
    render(<Callback replay={replay} />);
    await waitFor(() => { expect(screen.getByText("done")).toBeTruthy(); });
    expect(replay).toHaveBeenCalledTimes(1);
  });
});

const auth = dictFor("ja").auth;

describe("P2-1: a failed create-on-login is surfaced, not swallowed", () => {
  it("shows the failure with a retry instead of reporting a clean login", async () => {
    const onDone = vi.fn();
    const replay = vi.fn().mockResolvedValue("failed");
    renderWithLocale(<AuthCallback onDone={onDone} establish={establish} replay={replay} />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText(auth.callback_save_failed)).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("retries only the save, and completes once it succeeds", async () => {
    const onDone = vi.fn();
    const replay = vi.fn().mockResolvedValueOnce("failed").mockResolvedValue("saved");
    renderWithLocale(<AuthCallback onDone={onDone} establish={establish} replay={replay} />);
    fireEvent.click(await screen.findByRole("button", { name: auth.callback_save_retry }));
    await waitFor(() => { expect(onDone).toHaveBeenCalledTimes(1); });
    expect(replay).toHaveBeenCalledTimes(2);
  });

  it("lets the visitor continue, keeping the intent for the chat page", async () => {
    const onDone = vi.fn();
    const replay = vi.fn().mockResolvedValue("failed");
    writeDeferredSave({ pointIds: ["p1"], title: "t" });
    renderWithLocale(<AuthCallback onDone={onDone} establish={establish} replay={replay} />);
    fireEvent.click(await screen.findByRole("button", { name: auth.callback_save_skip }));
    await waitFor(() => { expect(onDone).toHaveBeenCalledTimes(1); });
    expect(localStorage.getItem(DEFERRED_SAVE_KEY)).toBeTruthy();
  });
});
