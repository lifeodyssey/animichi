"use client";

import React from "react";
import type { UIMessage, DynamicToolUIPart } from "ai";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useDict } from "../../lib/i18n-context";
import { Typewriter } from "../ui/typewriter";
import ThinkingProcess from "./ThinkingProcess";
import { PipelineCard } from "./ToolPartRenderer";
import FeedbackButtons from "./FeedbackButtons";

interface MessageBubbleProps {
  message: UIMessage;
  onActivate?: (messageId: string) => void;
  isActive?: boolean;
  onOpenDrawer?: () => void;
  isStreaming?: boolean;
  /** When true, shows a recoverable error state with retry affordance. */
  hasError?: boolean;
  onRetry?: () => void;
}

export default function MessageBubble({
  message,
  onActivate,
  isActive = false,
  onOpenDrawer,
  isStreaming = false,
  hasError = false,
  onRetry,
}: MessageBubbleProps) {
  const dict = useDict();
  const t = dict.chat;

  // All derived state from message.parts computed in a single pass.
  // Must be before any early return to satisfy React hooks rules.
  const { toolParts, textParts, dataResponseMessage, hasToolOutput, firstToolIndex } = React.useMemo(() => {
    const tools: DynamicToolUIPart[] = [];
    let dataMsg: string | null = null;

    for (const p of message.parts) {
      if (p.type === "dynamic-tool") {
        tools.push(p as DynamicToolUIPart);
      } else if (typeof p.type === "string" && p.type.startsWith("tool-")) {
        // SDK v6 static tool part — extract toolName from type prefix
        const part = p as Record<string, unknown>;
        tools.push({
          ...part,
          type: "dynamic-tool",
          toolName: (part.toolName as string) ?? p.type.replace("tool-", ""),
        } as DynamicToolUIPart);
      }

      if (p.type === "data-response") {
        const data = (p as Record<string, unknown>).data as Record<string, unknown> | undefined;
        if (data && typeof data.message === "string" && data.message) {
          dataMsg = data.message;
        }
      }
    }

    const texts = message.parts.filter(
      (p): p is { type: "text"; text: string } => p.type === "text" && !!p.text,
    );

    const hasOutput = tools.some((p) => p.state === "output-available");

    const firstIdx = message.parts.findIndex(
      (p) => p.type === "dynamic-tool" || (typeof p.type === "string" && p.type.startsWith("tool-")),
    );

    return {
      toolParts: tools,
      textParts: texts,
      dataResponseMessage: dataMsg,
      hasToolOutput: hasOutput,
      firstToolIndex: firstIdx,
    };
  }, [message.parts]);

  // User message — simple text bubble
  if (message.role === "user") {
    const text = textParts.map((p) => p.text).join("");
    return (
      <div className="entrance-message flex justify-end">
        <div className="max-w-[70%] rounded-xl bg-primary px-4 py-2.5 text-sm font-normal text-primary-fg">
          {text}
        </div>
      </div>
    );
  }

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

      {/* Parts in natural SSE order — pipeline card at first tool position */}
      {message.parts.map((part, i) => {
        if (part.type === "text" && (part as { text: string }).text) {
          return (
            <div key={`text-${i}`} className="prose prose-sm max-w-none text-foreground prose-headings:text-foreground prose-strong:text-foreground prose-a:text-primary">
              <Typewriter autoPlay={isStreaming} trigger={message.id}>
                <Markdown remarkPlugins={[remarkGfm]}>{(part as { text: string }).text}</Markdown>
              </Typewriter>
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

      {/* Agent summary message from data-response DataChunk */}
      {dataResponseMessage && (
        <div className="prose prose-sm max-w-none text-foreground prose-headings:text-foreground prose-strong:text-foreground prose-a:text-primary">
          <Markdown remarkPlugins={[remarkGfm]}>{dataResponseMessage}</Markdown>
        </div>
      )}

      {/* Error state — warm, recoverable */}
      {hasError && (
        <div className="flex items-center gap-2 rounded-[var(--r-sm)] bg-[var(--color-error)] px-3 py-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-error-fg)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span className="flex-1 text-sm text-error-fg">
            {t.error_message ?? "Something went wrong."}
          </span>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="text-sm font-medium text-error-fg underline underline-offset-4 hover:opacity-80"
            >
              {t.retry ?? "Retry"}
            </button>
          )}
        </div>
      )}

      {/* Feedback buttons — only shown when streaming is done and there's content */}
      {!isStreaming && !hasError && hasToolOutput && (
        <FeedbackButtons messageId={message.id} toolParts={toolParts} />
      )}
    </div>
  );
}
