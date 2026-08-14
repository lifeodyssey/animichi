import { describe, expect, it } from "vitest";
import {
  conversationMessagesUrl,
  healthzUrl,
  resolveChatConfig,
} from "../../../src/features/chat/config";

describe("resolveChatConfig", () => {
  it("prefers api.agentUrl for the chat base", () => {
    const config = resolveChatConfig({ agentUrl: "https://agent.test" });
    expect(config).toEqual({
      baseUrl: "https://agent.test",
      chatUrl: "https://agent.test/v1/chat",
    });
  });

  it("falls back to the browser origin, matching the C0.1 rules", () => {
    const config = resolveChatConfig({}, { origin: "http://localhost:3000" });
    expect(config.chatUrl).toBe("http://localhost:3000/v1/chat");
  });

  it("fails loud without any origin source instead of degrading to a relative base", () => {
    expect(() => resolveChatConfig({})).toThrow(/api\.siteOrigin/);
  });
});

describe("url builders", () => {
  it("builds the healthz url", () => {
    expect(healthzUrl("https://a.test")).toBe("https://a.test/healthz");
  });

  it("builds the conversation messages url with encoding", () => {
    expect(conversationMessagesUrl("https://a.test", "s/1")).toBe(
      "https://a.test/v1/conversations/s%2F1/messages",
    );
  });
});
