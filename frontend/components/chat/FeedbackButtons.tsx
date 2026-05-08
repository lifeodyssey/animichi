"use client";

import { useState } from "react";
import type { DynamicToolUIPart } from "ai";
import type { RuntimeResponse } from "../../lib/types";
import { submitFeedback } from "../../lib/api";
import { useDict } from "../../lib/i18n-context";

interface FeedbackButtonsProps {
  messageId: string;
  toolParts: DynamicToolUIPart[];
  userQuery?: string;
}

export default function FeedbackButtons({ messageId: _messageId, toolParts, userQuery }: FeedbackButtonsProps) {
  const { chat: t } = useDict();
  const [state, setState] = useState<"idle" | "commenting" | "submitted">("idle");
  const [comment, setComment] = useState("");

  // Extract session_id and intent from the first completed tool output
  const firstOutput = toolParts.find((p) => p.state === "output-available");
  const response = firstOutput?.state === "output-available"
    ? asRuntimeResponse(firstOutput.output)
    : null;
  const sessionId = response?.session_id ?? null;
  const intent = response?.intent ?? "unknown";

  async function handleFeedback(rating: "good" | "bad") {
    if (rating === "bad" && state === "idle") {
      setState("commenting");
      return;
    }

    try {
      await submitFeedback({
        session_id: sessionId,
        query_text: userQuery ?? "",
        intent,
        rating,
        comment: comment || undefined,
      });
      setState("submitted");
    } catch {
      // Silently fail — feedback is best-effort
    }
  }

  if (state === "submitted") {
    return (
      <p className="text-xs text-muted-foreground opacity-60">
        {t.feedback_sent}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-0.5 opacity-50 transition-opacity md:opacity-0 md:group-hover:opacity-50 md:group-focus-within:opacity-50 hover:!opacity-100" style={{ transitionDuration: "var(--duration-fast)" }}>
        <button
          aria-label={t.feedback_good_title}
          onClick={() => handleFeedback("good")}
          className="flex h-[44px] w-[44px] items-center justify-center rounded text-base text-muted-foreground transition hover:text-foreground"
          title={t.feedback_good_title}
        >
          {"\uD83D\uDC4D"}
        </button>
        <button
          aria-label={t.feedback_bad_title}
          onClick={() => handleFeedback("bad")}
          className="flex h-[44px] w-[44px] items-center justify-center rounded text-base text-muted-foreground transition hover:text-foreground"
          title={t.feedback_bad_title}
        >
          {"\uD83D\uDC4E"}
        </button>
      </div>
      {state === "commenting" && (
        <div className="flex gap-2">
          <input
            type="text"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={t.feedback_placeholder}
            aria-label={t.feedback_placeholder}
            className="flex-1 border-b border-border bg-transparent px-0 py-1 text-xs outline-none focus:border-primary"
          />
          <button
            onClick={() => handleFeedback("bad")}
            className="text-xs font-medium text-primary"
          >
            {t.send}
          </button>
        </div>
      )}
    </div>
  );
}

function asRuntimeResponse(output: unknown): RuntimeResponse | null {
  if (typeof output !== "object" || output === null) return null;
  const obj = output as Record<string, unknown>;
  if (typeof obj.intent !== "string") return null;
  return obj as unknown as RuntimeResponse;
}
