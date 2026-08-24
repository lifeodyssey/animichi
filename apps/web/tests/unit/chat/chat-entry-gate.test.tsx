/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatEntryGate } from "../../../src/features/chat/ChatEntryGate";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { LocaleProvider } from "../../../src/i18n/LocaleProvider";
import { clearTurnstileToken, currentTurnstileToken } from "../../../src/lib/turnstile/token-store";
import { RUNTIME_CONFIG_GLOBAL_KEY } from "../../../src/lib/runtime-config/provider";
import { DEFAULT_RUNTIME_CONFIG } from "../../../src/lib/runtime-config/runtime-config";
import { setLanguages } from "../_i18n";

const state = vi.hoisted(() => ({ auth: "anonymous" as "pending" | "authenticated" | "anonymous" }));
vi.mock("../../../src/lib/auth/session", () => ({ useAuthStatus: () => state.auth }));

const SITE_KEY = "0x4AAAAAAAsitekey24chars";
const dict = chatDictFor("ja").turnstile;

function view() {
  return render(<LocaleProvider><ChatEntryGate><p>chat mounted</p></ChatEntryGate></LocaleProvider>);
}

async function solve(token: string): Promise<void> {
  await act(async () => { window.onAnimichiTurnstile?.(token); await Promise.resolve(); });
}

beforeEach(() => {
  state.auth = "anonymous";
  setLanguages(["ja"]);
  clearTurnstileToken();
  vi.stubGlobal(RUNTIME_CONFIG_GLOBAL_KEY, { ...DEFAULT_RUNTIME_CONFIG, turnstileSiteKey: SITE_KEY });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the /chat entry gate", () => {
  it("does not mount chat while auth is pending", () => {
    state.auth = "pending";
    view();
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.queryByText("chat mounted")).toBeNull();
  });

  it("lets an authenticated visitor enter without loading Turnstile", () => {
    state.auth = "authenticated";
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    view();
    expect(screen.getByText("chat mounted")).toBeTruthy();
    expect(document.querySelector(".cf-turnstile")).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("keeps the authenticated bypass independent of public Turnstile config", () => {
    state.auth = "authenticated";
    vi.stubGlobal(RUNTIME_CONFIG_GLOBAL_KEY, { ...DEFAULT_RUNTIME_CONFIG, turnstileSiteKey: "malformed" });
    view();
    expect(screen.getByText("chat mounted")).toBeTruthy();
  });
});

describe("anonymous entry verification", () => {
  it("keeps chat unmounted until the server accepts the widget token", async () => {
    let accept: ((response: Response) => void) | undefined;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { accept = resolve; })));
    view();
    expect(document.querySelector(".turnstile-entry[data-active='true']")).toBeTruthy();
    await solve("fresh-token");
    expect(screen.queryByText("chat mounted")).toBeNull();
    act(() => { accept?.(new Response(null, { status: 204 })); });
    expect(await screen.findByText("chat mounted")).toBeTruthy();
  });

  it("fails closed on a rejected verification and offers retry", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 403 })));
    view();
    await solve("rejected-token");
    expect(await screen.findByRole("button", { name: dict.retry })).toBeTruthy();
    expect(screen.queryByText("chat mounted")).toBeNull();
    expect(currentTurnstileToken()).toBeUndefined();
  });

  it("retries after siteverify becomes available", async () => {
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetcher);
    view();
    await solve("first-token");
    const retry = await screen.findByRole("button", { name: dict.retry });
    fireEvent.click(retry);
    await solve("second-token");
    expect(await screen.findByText("chat mounted")).toBeTruthy();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("keeps an admitted chat mounted after the widget lifecycle ends", async () => {
    const reset = vi.fn();
    window.turnstile = { reset };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    view();
    await solve("expiring-token");
    await screen.findByText("chat mounted");
    expect(window.onAnimichiTurnstileExpired).toBeUndefined();
    expect(screen.getByText("chat mounted")).toBeTruthy();
    expect(reset).not.toHaveBeenCalled();
    window.turnstile = undefined;
  });
});
