"use client";

import { useState } from "react";
import type { DynamicToolUIPart } from "ai";
import { useDict } from "../../lib/i18n-context";

interface ThinkingProcessProps {
  toolParts: DynamicToolUIPart[];
  isStreaming: boolean;
}

type ToolState = DynamicToolUIPart["state"];

const COMPLETED_STATES = new Set<ToolState>(["output-available", "output-denied"]);
const FAILED_STATES = new Set<ToolState>(["output-error"]);
const RUNNING_STATES = new Set<ToolState>(["input-streaming", "input-available", "approval-requested", "approval-responded"]);

export default function ThinkingProcess({
  toolParts,
  isStreaming,
}: ThinkingProcessProps) {
  const [expanded, setExpanded] = useState(isStreaming);
  const dict = useDict();
  const t = dict.chat;
  const toolLabels = dict.thinking;

  if (toolParts.length === 0) {
    if (!isStreaming) return null;
    return (
      <div className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="animate-pulse">{"\uD83E\uDDE0"}</span>
        <span>{t?.thinking || "Thinking..."}</span>
      </div>
    );
  }

  const completed = toolParts.filter((p) => COMPLETED_STATES.has(p.state));
  const failed = toolParts.filter((p) => FAILED_STATES.has(p.state));

  const summary = completed
    .map((p) => toolLabels[p.toolName as keyof typeof toolLabels] || p.toolName)
    .join(" \u2192 ");

  const lastPart = toolParts[toolParts.length - 1];

  return (
    <div className="mb-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        style={{ transitionDuration: "var(--duration-fast)" }}
      >
        <span className={isStreaming ? "animate-pulse" : ""}>
          {"\uD83E\uDDE0"}
        </span>
        <span>
          {isStreaming
            ? toolLabels[lastPart.toolName as keyof typeof toolLabels] || t?.thinking || "Thinking..."
            : summary || t?.thought_complete || "Done"}
        </span>
        {failed.length > 0 && !isStreaming && (
          <span className="text-xs text-error-fg">
            ({failed.length} failed)
          </span>
        )}
        <span className="text-xs">{expanded ? "\u25BC" : "\u25B6"}</span>
      </button>

      {expanded && (
        <div className="mt-1.5 ml-4 flex flex-col gap-1 border-l-2 border-border pl-3">
          {toolParts.map((part) => {
            const isFailed = FAILED_STATES.has(part.state);
            const isRunning = RUNNING_STATES.has(part.state);
            const label = toolLabels[part.toolName as keyof typeof toolLabels] || part.toolName;

            return (
              <div key={part.toolCallId} className="text-xs">
                <div className="flex items-center gap-1.5">
                  <span
                    className={
                      isRunning
                        ? "text-primary animate-pulse"
                        : "text-muted-foreground"
                    }
                    style={
                      isFailed
                        ? { color: "var(--color-error-fg)" }
                        : undefined
                    }
                  >
                    {label}
                  </span>
                  <span
                    className={isRunning ? "text-primary" : ""}
                    style={{
                      color: isFailed
                        ? "var(--color-error-fg)"
                        : isRunning
                          ? undefined
                          : "var(--color-success-fg)",
                    }}
                  >
                    {isFailed ? "\u2717" : isRunning ? "\u23F3" : "\u2713"}
                  </span>
                </div>
                {isFailed && part.state === "output-error" && (
                  <div
                    className="ml-5 text-xs"
                    style={{ color: "var(--color-error-fg)" }}
                  >
                    {"\u26A0"} {part.errorText}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
