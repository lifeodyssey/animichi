/**
 * @vitest-environment jsdom
 */
import type { UIMessage } from "ai";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MessageList } from "../../../src/features/chat/components/MessageList";
import { chatDictFor } from "../../../src/features/chat/i18n";

const ja = chatDictFor("ja");

afterEach(cleanup);

function textMessage(): UIMessage {
  return { id: "a1", role: "assistant", parts: [{ type: "text", text: "こんにちは!" }] };
}

function toolMessage(): UIMessage {
  const tool = { type: "tool-resolve_anime", toolCallId: "t1", state: "output-available" };
  return { id: "a2", role: "assistant", parts: [tool] as unknown as UIMessage["parts"] };
}

describe("MessageList pure-text turn (Empty: B2a→B4, no pipeline)", () => {
  it("renders a text-only assistant turn without any pipeline or footprint", () => {
    render(<MessageList messages={[textMessage()]} dict={ja} status="ready" />);
    expect(screen.getByText("こんにちは!")).toBeTruthy();
    expect(document.querySelector(".chat-step")).toBeNull();
    expect(document.querySelector(".chat-settled")).toBeNull();
  });
});

describe("MessageList pipeline collapse", () => {
  it("collapses a settled tool turn into a footprint row with elapsed time", () => {
    render(<MessageList messages={[toolMessage()]} dict={ja} status="ready" settledDurationMs={9200} />);
    expect(document.querySelector(".chat-settled")).toBeTruthy();
    expect(screen.getByText("9.2s")).toBeTruthy();
  });

  it("keeps the pipeline inline while the turn is still streaming", () => {
    render(<MessageList messages={[toolMessage()]} dict={ja} status="streaming" />);
    expect(document.querySelector(".chat-settled")).toBeNull();
    const badge = screen.getByText(ja.toolSteps.labels.resolve_anime);
    expect(badge.getAttribute("data-tool")).toBe("resolve_anime");
  });
});
