/** @vitest-environment jsdom */
import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RUNTIME_CONFIG_GLOBAL_KEY } from "../../../src/lib/runtime-config/provider";
import { DEFAULT_RUNTIME_CONFIG } from "../../../src/lib/runtime-config/runtime-config";
import { setLanguages } from "../_i18n";
import { renderChatEntry, renderChatPage } from "./_chat-page";

const { getAuthToken } = vi.hoisted(() => ({ getAuthToken: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../../src/lib/auth/auth-session", () => ({
  getAuthToken,
  clearAuthToken: () => undefined,
  authHeaders: () => Promise.resolve({}),
}));

const SITE_KEY = "0x4AAAAAAAsitekey24chars";

beforeEach(() => {
  setLanguages(["ja"]);
  getAuthToken.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal(RUNTIME_CONFIG_GLOBAL_KEY, { ...DEFAULT_RUNTIME_CONFIG, turnstileSiteKey: SITE_KEY });
});

describe("the single Turnstile mount", () => {
  it("is absent from the chat composer", async () => {
    renderChatPage();
    await screen.findByRole("textbox");
    expect(document.querySelector(".chat-input + .turnstile-gate")).toBeNull();
    expect(document.querySelector(".cf-turnstile")).toBeNull();
  });

  it("lives in the full-viewport entry before the composer mounts", async () => {
    renderChatEntry();
    await waitFor(() => { expect(document.querySelector(".cf-turnstile")).not.toBeNull(); });
    expect(document.querySelector(".turnstile-entry[data-active='true'] .cf-turnstile")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("is bypassed for an authenticated visitor", async () => {
    getAuthToken.mockResolvedValue("jwt-token");
    renderChatEntry();
    await screen.findByRole("textbox");
    expect(document.querySelector(".cf-turnstile")).toBeNull();
  });
});
