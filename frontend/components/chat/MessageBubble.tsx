"use client";

import type { UIMessage, DynamicToolUIPart } from "ai";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useDict } from "../../lib/i18n-context";
import ThinkingProcess from "./ThinkingProcess";
import { PipelineCard } from "./ToolPartRenderer";
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

  // Assistant message — collect tool parts for pipeline card.
  // AI SDK v6 tool parts use "tool-{toolName}" format (e.g. "tool-clarify").
  // We normalize them to DynamicToolUIPart shape for PipelineCard.
  const toolParts: DynamicToolUIPart[] = [];
  for (const p of message.parts) {
    if (p.type === "dynamic-tool") {
      toolParts.push(p as DynamicToolUIPart);
    } else if (typeof p.type === "string" && p.type.startsWith("tool-")) {
      // SDK v6 static tool part — extract toolName from type prefix
      const part = p as Record<string, unknown>;
      toolParts.push({
        ...part,
        type: "dynamic-tool",
        toolName: (part.toolName as string) ?? p.type.replace("tool-", ""),
      } as DynamicToolUIPart);
    }
  }

  const textParts = message.parts.filter(
    (p): p is { type: "text"; text: string } => p.type === "text" && !!p.text,
  );

  const hasToolOutput = toolParts.some(
    (p) => p.state === "output-available",
  );

  const showPreThinking = isStreaming && toolParts.length === 0 && textParts.length === 0;

  // Index of the first tool part — pipeline card renders at this position.
  const firstToolIndex = message.parts.findIndex(
    (p) => p.type === "dynamic-tool" || (typeof p.type === "string" && p.type.startsWith("tool-")),
  );

  return (
    <div
      className="entrance-message group flex flex-col gap-2.5"
      aria-live={isStreaming ? "polite" : undefined}
    >
      <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground opacity-40">
        {t.bot_name}
      </p>

      {/* Pre-tool thinking indicator */}
      {showPreThinking && <ThinkingProcess isStreaming />}

      {/* Parts in natural SSE order — pipeline card at first tool position */}
      {message.parts.map((part, i) => {
        if (part.type === "text" && (part as { text: string }).text) {
          return (
            <div key={`text-${i}`} className="prose prose-sm max-w-none text-foreground prose-headings:text-foreground prose-strong:text-foreground prose-a:text-primary">
              <Markdown remarkPlugins={[remarkGfm]}>{(part as { text: string }).text}</Markdown>
            </div>
          );
        }
        // Render pipeline card once, at the position of the first tool part
        if (i === firstToolIndex && toolParts.length > 0) {
          return (
            <PipelineCard
              key="pipeline"
              parts={toolParts}
              messageId={message.id}
              onActivate={onActivate}
              isActive={isActive}
              onOpenDrawer={onOpenDrawer}
            />
          );
        }
        return null;
      })}

      {/* Feedback buttons — only shown when streaming is done and there's content */}
      {!isStreaming && hasToolOutput && (
        <FeedbackButtons messageId={message.id} toolParts={toolParts} />
      )}
    </div>
  );
}
