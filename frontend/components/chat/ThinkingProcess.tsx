"use client";

import { useDict } from "../../lib/i18n-context";
import { Skeleton } from "../ui/skeleton";

// ---------------------------------------------------------------------------
// ThinkingProcess — minimal pre-tool streaming indicator.
//
// Shown only when streaming starts and no tool parts have arrived yet.
// Once tool parts arrive, the PipelineCard takes over all display.
// ---------------------------------------------------------------------------

interface ThinkingProcessProps {
  isStreaming: boolean;
}

export default function ThinkingProcess({ isStreaming }: ThinkingProcessProps) {
  const { thinking: thinkingDict } = useDict();

  if (!isStreaming) return null;

  const label = (thinkingDict as Record<string, string>).pre_thinking ?? "Thinking...";

  return (
    <div className="flex items-center gap-3 py-1" data-testid="thinking-indicator">
      <Skeleton className="h-2 w-2 rounded-full" />
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}
