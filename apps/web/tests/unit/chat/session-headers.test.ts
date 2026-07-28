/**
 * @vitest-environment jsdom
 *
 * `sessionHeaders()` (issue #260/#445 shared-module extraction) is the single
 * injection point for both the chat transport and photo search. This file
 * pins its BYOK header behaviour (#284 Task 6) directly at the function,
 * independent of either caller — see also `photo-search-client.test.ts`'s
 * "BYOK headers on photo search (#284 P1-2)" describe block, which asserts
 * the same semantics survive through that specific transport.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearByokConfig, saveByokConfig } from "../../../src/lib/byok/byokStorage";
import { sessionHeaders } from "../../../src/features/chat/session-headers";

const { authHeaders } = vi.hoisted(() => ({ authHeaders: vi.fn().mockResolvedValue({}) }));
vi.mock("../../../src/lib/auth/authSession", () => ({ authHeaders }));

afterEach(() => {
  authHeaders.mockReset().mockResolvedValue({});
  clearByokConfig();
});

describe("sessionHeaders() identity headers (regression, pre-BYOK behaviour)", () => {
  it("emits x-session-id only when a session id is known", async () => {
    expect(await sessionHeaders("s-1")).toMatchObject({ "x-session-id": "s-1" });
    expect(await sessionHeaders()).not.toHaveProperty("x-session-id");
  });

  it("injects the Bearer token in place of a Turnstile header once signed in", async () => {
    authHeaders.mockResolvedValue({ Authorization: "Bearer jwt" });
    expect(await sessionHeaders()).toMatchObject({ Authorization: "Bearer jwt" });
  });
});

describe("sessionHeaders() BYOK injection (#284 Task 6)", () => {
  it("emits exactly today's header set when nothing is saved", async () => {
    expect(await sessionHeaders("s-1")).toEqual({ "x-session-id": "s-1" });
  });

  it("adds the full X-BYOK-* set for openai-compatible on top of the identity headers", async () => {
    authHeaders.mockResolvedValue({ Authorization: "Bearer jwt" });
    saveByokConfig({
      provider: "openai-compatible",
      apiKey: "sk-test",
      model: "gpt-5",
      baseUrl: "https://api.example.com/v1",
    });
    expect(await sessionHeaders("s-1")).toEqual({
      "x-session-id": "s-1",
      Authorization: "Bearer jwt",
      "X-BYOK-Provider": "openai-compatible",
      "X-BYOK-Key": "sk-test",
      "X-BYOK-Model": "gpt-5",
      "X-BYOK-Base-Url": "https://api.example.com/v1",
    });
  });

  it("omits X-BYOK-Base-Url for anthropic/gemini", async () => {
    saveByokConfig({ provider: "anthropic", apiKey: "ak", model: "claude-sonnet-4-5" });
    const headers = await sessionHeaders();
    expect(headers["X-BYOK-Base-Url"]).toBeUndefined();
    expect(headers["X-BYOK-Provider"]).toBe("anthropic");
  });

  it("adds BYOK headers to an anonymous (no-Authorization) turn too — the container is the authority on rejecting it, not the client", async () => {
    saveByokConfig({ provider: "gemini", apiKey: "gk", model: "gemini-2.5-flash" });
    const headers = await sessionHeaders();
    expect(headers.Authorization).toBeUndefined();
    expect(headers["X-BYOK-Provider"]).toBe("gemini");
  });
});
