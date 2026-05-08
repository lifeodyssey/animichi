"use client";

import type { UIMessage, DynamicToolUIPart } from "ai";
import { useDict } from "../../lib/i18n-context";
import ThinkingProcess from "./ThinkingProcess";
import ToolPartRenderer from "./ToolPartRenderer";
import FeedbackButtons from "./FeedbackButtons";

interface MessageBubbleProps {
  message: UIMessage;
  onActivate?: (messageId: string) => void;
  isActive?: boolean;
  onOpenDrawer?: () => void;
  isStreaming?: boolean;
}

export default function MessageBubble({
  message,
  onActivate,
  isActive = false,
  onOpenDrawer,
  isStreaming = false,
}: MessageBubbleProps) {
  const dict = useDict();
  const t = dict.chat;

  if (message.role === "user") {
    const text = message.parts
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join("");

    return (
      <div className="entrance-message flex justify-end">
        <div className="max-w-[70%] rounded-xl bg-primary px-4 py-2.5 text-sm font-normal text-primary-fg">
          {text}
        </div>
      </div>
    );
  }

  // Assistant message — render each part
  const toolParts = message.parts.filter(
    (p): p is DynamicToolUIPart => p.type === "dynamic-tool",
  );

  const hasToolOutput = toolParts.some(
    (p) => p.state === "output-available",
  );

  return (
    <div
      className="entrance-message group flex flex-col gap-2.5"
      aria-live={isStreaming ? "polite" : undefined}
    >
      <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground opacity-40">
        {t.bot_name}
      </p>

      {/* Thinking indicator — shows tool execution progress */}
      {toolParts.length > 0 && (
        <ThinkingProcess toolParts={toolParts} isStreaming={isStreaming} />
      )}

      {/* No tool parts and streaming — show bare thinking indicator */}
      {toolParts.length === 0 && isStreaming && !hasTextContent(message) && (
        <div className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="animate-pulse">{"\uD83E\uDDE0"}</span>
          <span>{t?.thinking || "Thinking..."}</span>
        </div>
      )}

      {/* Render each part */}
      {message.parts.map((part, i) => {
        if (part.type === "text" && part.text) {
          return (
            <p key={`text-${i}`} className="text-sm font-light leading-loose text-foreground">
              {part.text}
            </p>
          );
        }

        if (part.type === "dynamic-tool") {
          return (
            <ToolPartRenderer
              key={part.toolCallId}
              part={part}
              messageId={message.id}
              onActivate={onActivate}
              isActive={isActive}
              onOpenDrawer={onOpenDrawer}
            />
          );
        }

        // Reasoning, step-start, source parts — skip for now
        return null;
      })}

      {/* Feedback buttons — only shown when streaming is done and there's content */}
      {!isStreaming && hasToolOutput && (
        <FeedbackButtons messageId={message.id} toolParts={toolParts} />
      )}
    </div>
  );
}

function hasTextContent(message: UIMessage): boolean {
  return message.parts.some(
    (p) => p.type === "text" && p.text.trim().length > 0,
  );
}
