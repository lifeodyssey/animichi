/**
 * @vitest-environment jsdom
 *
 * Issue #447: the widget is actually MOUNTED on the anonymous chat entry (the
 * gate component itself is pinned by turnstile-gate.test.tsx). It sits in the
 * dock's hint slot, only anonymous visitors load it, and the edge's retryable
 * 403 surfaces as the challenge's own retry — never as "your session expired".
 */
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { rememberTurnstileToken } from "../../../src/lib/turnstile/tokenStore";
import { server } from "../../msw/node";
import { chatStreamHandler, chatTurnstileRequiredHandler } from "../../msw/chat-handlers";
import { setLanguages } from "../_i18n";
import { renderChatPage } from "./_chat-page";

const { getAuthToken } = vi.hoisted(() => ({ getAuthToken: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../../src/lib/auth/authSession", () => ({
  getAuthToken,
  clearAuthToken: () => undefined,
  authHeaders: async () => {
    const token = (await getAuthToken()) as string | undefined;
    return token === undefined ? {} : { Authorization: `Bearer ${token}` };
  },
}));

const SITE_KEY = "0x4AAAAAAAsitekey24chars";
const ja = chatDictFor("ja");

beforeEach(() => {
  setLanguages(["ja"]);
  getAuthToken.mockReset().mockResolvedValue(undefined);
  vi.stubEnv("VITE_TURNSTILE_SITE_KEY", SITE_KEY);
});

function widget(): Element | null {
  return document.querySelector(".cf-turnstile");
}

/** Drive the widget's own `data-callback`, the only source of a token. */
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

describe("who gets the widget", () => {
  it("mounts it for an anonymous visitor, carrying the configured site key", async () => {
    renderChatPage();
    await waitFor(() => {
      expect(widget()).not.toBeNull();
    });
    expect(widget()?.getAttribute("data-sitekey")).toBe(SITE_KEY);
  });

  it("keeps it inside the dock, after the composer rather than above the thread", async () => {
    renderChatPage();
    await waitFor(() => {
      expect(widget()).not.toBeNull();
    });
    const input = document.querySelector(".chat-input");
    const gate = document.querySelector(".turnstile-gate");
    expect(input?.nextElementSibling).toBe(gate);
  });

  it("never loads it for a signed-in visitor", async () => {
    getAuthToken.mockResolvedValue("jwt-token");
    renderChatPage();
    await waitFor(() => {
      expect(screen.getByRole("textbox")).toBeTruthy();
    });
    expect(widget()).toBeNull();
  });

  it("renders nothing when a production build configured no site key", async () => {
    vi.stubEnv("VITE_TURNSTILE_SITE_KEY", "");
    vi.stubEnv("DEV", false);
    renderChatPage();
    await waitFor(() => {
      expect(screen.getByRole("textbox")).toBeTruthy();
    });
    expect(widget()).toBeNull();
  });
});

/**
 * P1-3 (#447 review): suppressing the failure strip is only safe while a widget
 * exists to offer the recovery. A misconfigured deployment — no site key, or an
 * edge with no TURNSTILE_SECRET, both of which 403 every turn — must not leave
 * the visitor staring at a chat that silently does nothing.
 */
describe("a misconfigured build still shows the failure", () => {
  it("falls back to the generic retry strip when no widget can be rendered", async () => {
    vi.stubEnv("VITE_TURNSTILE_SITE_KEY", "");
    vi.stubEnv("DEV", false);
    server.use(chatTurnstileRequiredHandler());
    renderChatPage();
    sendText("ユーフォ");
    expect(await screen.findByText(ja.errorStates.d4Message)).toBeTruthy();
    expect(screen.getByRole("button", { name: ja.errorStates.d4Retry })).toBeTruthy();
    expect(widget()).toBeNull();
  });

  it("never tells a challenged anonymous visitor their session expired", async () => {
    vi.stubEnv("VITE_TURNSTILE_SITE_KEY", "");
    vi.stubEnv("DEV", false);
    server.use(chatTurnstileRequiredHandler());
    renderChatPage();
    sendText("ユーフォ");
    await screen.findByText(ja.errorStates.d4Message);
    expect(screen.queryByText(ja.errorStates.d8Message)).toBeNull();
    expect(screen.queryByRole("button", { name: ja.errorStates.d8Login })).toBeNull();
  });
});

/** The transport waits for a token before sending, so a turn only reaches the
 * edge's rejection when one is held — i.e. a spent or expired token. */
function seedSpentToken(): void {
  rememberTurnstileToken("spent-token");
}

describe("the edge rejects the turn", () => {
  it("offers the challenge's own retry instead of the expired-session banner", async () => {
    server.use(chatTurnstileRequiredHandler());
    renderChatPage();
    seedSpentToken();
    sendText("ユーフォ");
    expect(await screen.findByText(ja.turnstile.failed)).toBeTruthy();
    expect(screen.queryByText(ja.errorStates.d8Message)).toBeNull();
    expect(screen.queryByRole("button", { name: ja.errorStates.d8Login })).toBeNull();
  });

  it("resends the rejected turn once the visitor retries", async () => {
    const seen: Request[] = [];
    server.use(chatTurnstileRequiredHandler((request) => seen.push(request)));
    renderChatPage();
    seedSpentToken();
    sendText("ユーフォ");
    await screen.findByText(ja.turnstile.failed);
    server.use(chatStreamHandler("search"));
    fireEvent.click(screen.getByRole("button", { name: ja.turnstile.retry }));
    await solve("fresh-token");
    expect(await screen.findByText("宇治の聖地を2件、徒歩ルートにまとめました。")).toBeTruthy();
    expect(seen).toHaveLength(1);
  });

  it("re-arms the widget on retry — a spent token would only be rejected again", async () => {
    const reset = vi.fn();
    window.turnstile = { reset };
    server.use(chatTurnstileRequiredHandler());
    renderChatPage();
    seedSpentToken();
    sendText("ユーフォ");
    await screen.findByText(ja.turnstile.failed);
    fireEvent.click(screen.getByRole("button", { name: ja.turnstile.retry }));
    expect(reset).toHaveBeenCalledTimes(1);
    window.turnstile = undefined;
  });

  it("clears the challenge once a turn succeeds", async () => {
    server.use(chatTurnstileRequiredHandler());
    renderChatPage();
    seedSpentToken();
    sendText("ユーフォ");
    await screen.findByText(ja.turnstile.failed);
    server.use(chatStreamHandler("search"));
    fireEvent.click(screen.getByRole("button", { name: ja.turnstile.retry }));
    await solve("fresh-token");
    await screen.findByText("宇治の聖地を2件、徒歩ルートにまとめました。");
    expect(screen.queryByText(ja.turnstile.failed)).toBeNull();
  });
});
