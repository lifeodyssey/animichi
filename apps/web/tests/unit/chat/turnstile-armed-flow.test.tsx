/**
 * @vitest-environment jsdom
 *
 * Issue #447 review (P1-1): against an edge that really requires the token,
 * not a handler that answers 200 regardless. Two failure modes are pinned here
 * because both shipped green under a permissive handler: a retry that resends
 * in the same tick as `turnstile.reset()` (always tokenless), and `?q=`
 * auto-send racing the widget's first solve.
 */
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { clearTurnstileToken, rememberTurnstileToken } from "../../../src/lib/turnstile/tokenStore";
import { server } from "../../msw/node";
import { armedChatHandler } from "../../msw/chat-handlers";
import { setLanguages } from "../_i18n";
import { chatSearch, renderChatPage } from "./_chat-page";

const { getAuthToken } = vi.hoisted(() => ({ getAuthToken: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../../src/lib/auth/authSession", () => ({
  getAuthToken,
  clearAuthToken: () => undefined,
  authHeaders: () => Promise.resolve({}),
}));

const SITE_KEY = "0x4AAAAAAAsitekey24chars";
const ja = chatDictFor("ja");
const ANSWER = "宇治の聖地を2件、徒歩ルートにまとめました。";

beforeEach(() => {
  setLanguages(["ja"]);
  clearTurnstileToken();
  getAuthToken.mockReset().mockResolvedValue(undefined);
  vi.stubEnv("VITE_TURNSTILE_SITE_KEY", SITE_KEY);
});

/**
 * Seed the token the edge will reject. A token is single-use at siteverify, so
 * this is the realistic way a turn earns a 403 now that the transport waits for
 * a token before sending: the visitor holds one, it is spent or expired, and
 * the edge says so.
 */
const SPENT = "spent-token";

function seedSpentToken(): void {
  rememberTurnstileToken(SPENT);
}

/** Drive the widget's own `data-callback` — the only way a token ever lands. */
async function solve(token: string): Promise<void> {
  await act(async () => {
    window.onAnimichiTurnstile?.(token);
    await Promise.resolve();
  });
}

function sendText(text: string) {
  fireEvent.change(screen.getByRole("textbox"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: ja.send }));
}

async function waitForWidget(): Promise<void> {
  await waitFor(() => {
    expect(window.onAnimichiTurnstile).toBeTypeOf("function");
  });
}

describe("retry after the edge challenged the turn", () => {
  it("resends only once a replacement token has landed, and carries it", async () => {
    const seen: (string | null)[] = [];
    server.use(armedChatHandler("search", seen, [SPENT]));
    renderChatPage();
    await waitForWidget();
    seedSpentToken();
    sendText("ユーフォ");
    await screen.findByText(ja.turnstile.failed);
    fireEvent.click(screen.getByRole("button", { name: ja.turnstile.retry }));
    await solve("fresh-token");
    expect(await screen.findByText(ANSWER)).toBeTruthy();
    expect(seen).toEqual(["spent-token", "fresh-token"]);
  });

  it("puts no tokenless request on the wire while the widget is still solving", async () => {
    const seen: (string | null)[] = [];
    server.use(armedChatHandler("search", seen, [SPENT]));
    renderChatPage();
    await waitForWidget();
    seedSpentToken();
    sendText("ユーフォ");
    await screen.findByText(ja.turnstile.failed);
    fireEvent.click(screen.getByRole("button", { name: ja.turnstile.retry }));
    await act(async () => { await Promise.resolve(); });
    expect(seen).toEqual(["spent-token"]);
    expect(screen.getByRole("button", { name: ja.turnstile.retry })).toBeTruthy();
  });

  it("does not throw away a token the widget solved before the click", async () => {
    const seen: (string | null)[] = [];
    server.use(armedChatHandler("search", seen, [SPENT]));
    renderChatPage();
    await waitForWidget();
    seedSpentToken();
    sendText("ユーフォ");
    await screen.findByText(ja.turnstile.failed);
    fireEvent.click(screen.getByRole("button", { name: ja.turnstile.retry }));
    await solve("second-token");
    expect(await screen.findByText(ANSWER)).toBeTruthy();
    expect(seen.at(-1)).toBe("second-token");
  });
});

describe("?q= auto-send against an armed edge", () => {
  it("waits for the first solved token instead of burning the turn on a 403", async () => {
    const seen: (string | null)[] = [];
    server.use(armedChatHandler("search", seen));
    renderChatPage(chatSearch({ q: "ユーフォ" }));
    await waitForWidget();
    await act(async () => { await Promise.resolve(); });
    expect(seen).toEqual([]);
    await solve("hero-token");
    expect(await screen.findByText(ANSWER)).toBeTruthy();
    expect(seen).toEqual(["hero-token"]);
  });

  it("still fires immediately when no challenge is in play", async () => {
    vi.stubEnv("VITE_TURNSTILE_SITE_KEY", "");
    vi.stubEnv("DEV", false);
    const seen: (string | null)[] = [];
    server.use(armedChatHandler("search", seen));
    getAuthToken.mockResolvedValue("jwt-token");
    renderChatPage(chatSearch({ q: "ユーフォ" }));
    await waitFor(() => {
      expect(seen).toEqual([null]);
    });
  });
});
