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

  // While streaming, hide text if tools exist — prevents flicker as
  // multi-step agent interleaves text and tool parts across steps.
  const showText = !isStreaming || toolParts.length === 0;

  const showPreThinking = isStreaming && toolParts.length === 0 && textParts.length === 0;

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

      {/* Pipeline card — groups all tool parts into a single progress view */}
      {toolParts.length > 0 && (
        <PipelineCard
          parts={toolParts}
          messageId={message.id}
          onActivate={onActivate}
          isActive={isActive}
          onOpenDrawer={onOpenDrawer}
        />
      )}

      {/* Text parts — rendered as markdown, hidden while tools are running */}
      {showText && textParts.map((part, i) => (
        <div key={`text-${i}`} className="prose prose-sm max-w-none text-foreground prose-headings:text-foreground prose-strong:text-foreground prose-a:text-primary">
          <Markdown remarkPlugins={[remarkGfm]}>{part.text}</Markdown>
        </div>
      ))}

      {/* Feedback buttons — only shown when streaming is done and there's content */}
      {!isStreaming && hasToolOutput && (
        <FeedbackButtons messageId={message.id} toolParts={toolParts} />
      )}
    </div>
  );
}
