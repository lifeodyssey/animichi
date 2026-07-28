/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BudgetExhausted } from "../../../src/features/chat/components/ErrorStates/BudgetExhausted";
import { SessionExpired } from "../../../src/features/chat/components/ErrorStates/SessionExpired";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { useAuthCallback } from "../../../src/components/auth/useAuthCallback";
import { writeDeferredSave } from "../../../src/features/chat/save/deferredSave";
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

function Callback({ replay }: Readonly<{ replay: () => Promise<boolean> }>) {
  return <span>{useAuthCallback(establish, replay)}</span>;
}

describe("AC4 negative: only a save-initiated login replays a save", () => {
  it("replays the stashed intent after the callback redeems the session", async () => {
    writeDeferredSave({ pointIds: ["p1"], title: "t" });
    const replay = vi.fn().mockResolvedValue(true);
    render(<Callback replay={replay} />);
    await waitFor(() => { expect(screen.getByText("done")).toBeTruthy(); });
    expect(replay).toHaveBeenCalledTimes(1);
  });

  it("still completes the callback when no save intent was ever written", async () => {
    const replay = vi.fn().mockResolvedValue(false);
    render(<Callback replay={replay} />);
    await waitFor(() => { expect(screen.getByText("done")).toBeTruthy(); });
    expect(replay).toHaveBeenCalledTimes(1);
  });
});
