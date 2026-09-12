import { describe, expect, it } from "vitest";
import { journeyTitle, shortenTitle } from "../../../src/features/chat/lib/journey-title";
import type { HistoryEntry } from "../../../src/features/chat/use-conversation-history";
import type { UIMessage } from "ai";

const userEntry = (content: string): HistoryEntry => ({ role: "user", content });

function liveUser(text: string): UIMessage {
  return { id: "m1", role: "user", parts: [{ type: "text", text }] };
}

describe("shortenTitle", () => {
  it("collapses whitespace into a single line", () => {
    expect(shortenTitle("  宇治に\n行きたい   ")).toBe("宇治に 行きたい");
  });

  it("caps long topics at one row with an ellipsis", () => {
    const long = "響け！ユーフォニアムの聖地を巡る宇治半日ハイライト旅";
    expect(shortenTitle(long)).toBe(`${long.slice(0, 24)}…`);
  });
});

describe("journeyTitle", () => {
  it("prefers the first user line of restored history", () => {
    const history = [{ role: "assistant", content: "ようこそ" }, userEntry("宇治に行きたい")];
    expect(journeyTitle(history, [liveUser("別の話題")])).toBe("宇治に行きたい");
  });

  it("falls back to the live session's first user message", () => {
    expect(journeyTitle([], [liveUser("鎌倉を歩く")])).toBe("鎌倉を歩く");
  });

  it("is undefined while the conversation has no user words yet", () => {
    expect(journeyTitle([], [])).toBeUndefined();
    expect(journeyTitle([{ role: "assistant", content: "ようこそ" }], [])).toBeUndefined();
  });
});
