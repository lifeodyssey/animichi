/**
 * @vitest-environment jsdom
 */
import type { UIMessage } from "ai";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MessageList } from "../../../src/features/chat/components/MessageList";
import { chatDictFor } from "../../../src/features/chat/i18n";
import { skeletonCopy } from "../../../src/features/chat/skeleton-copy";

const ja = chatDictFor("ja");

afterEach(cleanup);

function textMessage(): UIMessage {
  return { id: "a1", role: "assistant", parts: [{ type: "text", text: "こんにちは!" }] };
}

function toolMessage(): UIMessage {
  const tool = { type: "tool-resolve_anime", toolCallId: "t1", state: "output-available" };
  return { id: "a2", role: "assistant", parts: [tool] as unknown as UIMessage["parts"] };
}

function outputProgressMessage(): UIMessage {
  const progress = { type: "data-response", id: "response", data: { intent: "general_qa" } };
  return { id: "a4", role: "assistant", parts: [progress] as unknown as UIMessage["parts"] };
}

describe("MessageList pure-text turn (Empty: B2a→B4, no pipeline)", () => {
  it("renders a text-only assistant turn without any pipeline or footprint", () => {
    render(<MessageList messages={[textMessage()]} dict={ja} status="ready" />);
    expect(screen.getByText("こんにちは!")).toBeTruthy();
    expect(document.querySelector(".chat-step")).toBeNull();
    expect(document.querySelector(".chat-settled")).toBeNull();
  });
});

function retryMessage(retryState: string): UIMessage {
  const failed = { type: "tool-search_bangumi", toolCallId: "t1", state: "output-error", errorText: "duplicate call" };
  const retry = { type: "tool-search_bangumi", toolCallId: "t2", state: retryState };
  return { id: "a3", role: "assistant", parts: [failed, retry] as unknown as UIMessage["parts"] };
}

function statusesOf(): (string | null)[] {
  return [...document.querySelectorAll(".chat-step")].map((step) => step.getAttribute("data-status"));
}

describe("MessageList ModelRetry supersession", () => {
  it("mutes the superseded step while the retry is still in flight", () => {
    render(<MessageList messages={[retryMessage("input-available")]} dict={ja} status="streaming" />);
    expect(statusesOf()).toEqual(["retried", "running"]);
  });

  it("shows no error step once the retry succeeded", () => {
    render(<MessageList messages={[retryMessage("output-available")]} dict={ja} status="ready" />);
    expect(statusesOf()).toEqual(["retried", "done"]);
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
    const badge = screen.getByText(ja.toolSteps.actions.resolve_anime);
    expect(badge.closest("[data-tool]")?.getAttribute("data-tool")).toBe("resolve_anime");
  });

  it("omits a footprint for a turn containing only hidden tool steps", () => {
    const part = { type: "tool-translate_anime_title", toolCallId: "hidden", state: "output-available", input: {}, output: {} };
    const message = { id: "hidden", role: "assistant", parts: [part] } as UIMessage;
    render(<MessageList messages={[message]} dict={ja} status="ready" />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(document.querySelector(".chat-step")).toBeNull();
  });
});

describe("MessageList output progress lifecycle", () => {
  it("stops presenting unfinished tool work as running after the turn fails", () => {
    render(<MessageList messages={[retryMessage("input-available")]} dict={ja} status="error" />);
    expect(statusesOf()).toEqual(["retried", "error"]);
    expect(screen.queryByText(ja.toolSteps.labels.search_bangumi)).toBeNull();
    expect(screen.getByText(ja.toolSteps.failed)).toBeTruthy();
  });

  it("removes the busy skeleton when a turn settles without a final envelope", () => {
    render(<MessageList messages={[outputProgressMessage()]} dict={ja} status="error" />);
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
    expect(document.querySelector(".chat-card--skeleton")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe(skeletonCopy(ja.locale).incomplete);
  });
});
