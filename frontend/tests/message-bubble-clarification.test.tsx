/**
 * MessageBubble — needs_clarification status rendering.
 * Split from clarification-redesign.test.tsx.
 *
 * AC coverage:
 * - needs_clarification status renders inline in MessageBubble -> unit
 *
 * Note: With UIMessage.parts, clarification is rendered via ToolPartRenderer
 * when a "clarify" tool part is present. This test verifies that the tool
 * part triggers the Clarification component through the full MessageBubble
 * render path.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import MessageBubble from "@/components/chat/MessageBubble";
import type { UIMessage, DynamicToolUIPart } from "ai";
import type { ClarifyCandidate } from "@/lib/types";
import defaultDict from "@/lib/dictionaries/ja.json";

vi.mock("@/lib/i18n-context", () => ({
  useDict: () => defaultDict,
}));

vi.mock("@/contexts/SuggestContext", () => ({
  useSuggest: () => vi.fn(),
}));

const CANDIDATE_WITH_COVER: ClarifyCandidate = {
  title: "涼宮ハルヒの憂鬱",
  cover_url: "https://image.anitabi.cn/bangumi/485.jpg",
  spot_count: 134,
  city: "西宮市",
};

const CANDIDATE_NO_COVER: ClarifyCandidate = {
  title: "涼宮ハルヒの消失",
  cover_url: null,
  spot_count: 42,
  city: "西宮市",
};

/** PydanticAI raw clarify tool output format. */
function makeClarifyOutput(candidates: ClarifyCandidate[] = [CANDIDATE_WITH_COVER]) {
  return {
    question: "どちらの作品ですか？",
    options: candidates.map((c) => c.title),
    candidates: candidates.map((c) => ({
      title: c.title,
      bangumi_id: "12345",
      cover_url: c.cover_url,
      points_count: c.spot_count,
      city: c.city,
    })),
    status: "needs_clarification",
  };
}

function makeClarifyMessage(candidates: ClarifyCandidate[]): UIMessage {
  const output = makeClarifyOutput(candidates);
  const toolPart: DynamicToolUIPart = {
    type: "dynamic-tool",
    toolName: "clarify",
    toolCallId: "call-clarify-001",
    state: "output-available",
    input: {},
    output,
  } as DynamicToolUIPart;

  return {
    id: "msg-001",
    role: "assistant",
    parts: [
      { type: "text", text: "どちらの作品ですか？" },
      toolPart,
    ],
  };
}

describe("MessageBubble needs_clarification rendering", () => {
  it("renders clarification text for needs_clarification response", () => {
    const message = makeClarifyMessage([CANDIDATE_WITH_COVER]);
    render(<MessageBubble message={message} />);
    // Text part + clarification component both render the message,
    // so we check that at least one element contains it.
    const matches = screen.getAllByText(/どちらの作品ですか/);
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("renders candidate buttons inside MessageBubble for needs_clarification", () => {
    const message = makeClarifyMessage([CANDIDATE_WITH_COVER, CANDIDATE_NO_COVER]);
    render(<MessageBubble message={message} />);
    expect(screen.getByRole("button", { name: /涼宮ハルヒの憂鬱/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /涼宮ハルヒの消失/ })).toBeInTheDocument();
  });

  it("does NOT render the result anchor for needs_clarification responses", () => {
    const message = makeClarifyMessage([CANDIDATE_WITH_COVER]);
    render(<MessageBubble message={message} />);
    const anchorBtn = screen.queryByRole("button", { name: /件の結果|results/ });
    expect(anchorBtn).toBeNull();
  });
});
