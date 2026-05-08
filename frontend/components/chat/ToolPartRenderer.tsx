"use client";

import type { DynamicToolUIPart } from "ai";
import { isSearchData, isRouteData, isClarifyData } from "../../lib/types";
import type { RuntimeResponse } from "../../lib/types";
import { isVisualResponse } from "../generative/registry";
import { useSuggest } from "../../contexts/SuggestContext";
import { useDict } from "../../lib/i18n-context";
import NearbyBubble from "../generative/NearbyBubble";
import Clarification from "../generative/Clarification";
import ResultAnchor from "./ResultAnchor";

// ---------------------------------------------------------------------------
// ToolPartRenderer — maps dynamic tool parts to generative UI components.
//
// Our backend uses the PydanticAI agent pattern where tools return a
// RuntimeResponse. The tool output is the full RuntimeResponse object.
// We use `DynamicToolUIPart` because tool names are not statically
// registered in the AI SDK client config.
// ---------------------------------------------------------------------------

/** Tool names that produce visual results shown in the result panel. */
const VISUAL_TOOLS = new Set([
  "search_bangumi",
  "search_by_bangumi",
  "plan_route",
  "plan_selected",
]);

interface ToolPartRendererProps {
  part: DynamicToolUIPart;
  messageId: string;
  onActivate?: (messageId: string) => void;
  isActive?: boolean;
  onOpenDrawer?: () => void;
}

export default function ToolPartRenderer({
  part,
  messageId,
  onActivate,
  isActive = false,
  onOpenDrawer,
}: ToolPartRendererProps) {
  const { chat: t } = useDict();
  const suggest = useSuggest();

  const toolName = part.toolName;

  switch (part.state) {
    case "input-streaming":
    case "input-available":
      return <ToolLoading toolName={toolName} />;

    case "output-available":
      return (
        <ToolOutput
          toolName={toolName}
          output={part.output}
          messageId={messageId}
          onActivate={onActivate}
          isActive={isActive}
          onOpenDrawer={onOpenDrawer}
          onSuggest={suggest}
          dict={t}
        />
      );

    case "output-error":
      return <ToolErrorDisplay toolName={toolName} errorText={part.errorText} />;

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ToolLoading({ toolName }: { toolName: string }) {
  const dict = useDict();
  const label = dict.thinking[toolName as keyof typeof dict.thinking];
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="h-4 w-4 animate-pulse rounded-full bg-muted" />
      <span className="animate-pulse text-xs text-muted-foreground">
        {typeof label === "string" ? label : toolName}
      </span>
    </div>
  );
}

function ToolErrorDisplay({
  toolName,
  errorText,
}: {
  toolName: string;
  errorText: string;
}) {
  return (
    <div className="text-sm text-error-fg">
      {toolName}: {errorText}
    </div>
  );
}

function ToolOutput({
  toolName,
  output,
  messageId,
  onActivate,
  isActive,
  onOpenDrawer,
  onSuggest,
  dict,
}: {
  toolName: string;
  output: unknown;
  messageId: string;
  onActivate?: (messageId: string) => void;
  isActive: boolean;
  onOpenDrawer?: () => void;
  onSuggest: (text: string) => void;
  dict: Record<string, string>;
}) {
  // Try to interpret output as RuntimeResponse
  const response = asRuntimeResponse(output);
  if (!response) return null;

  // Visual tools -> show a result anchor (the full result renders in ResultPanel)
  if (VISUAL_TOOLS.has(toolName) && isVisualResponse(response)) {
    return (
      <ResultAnchor
        label={dict.anchor_results?.replace("{count}", String(getResultCount(response))) ?? ""}
        subtitle={dict.tap_to_view ?? ""}
        messageId={messageId}
        onActivate={onActivate}
        isActive={isActive}
        onOpenDrawer={onOpenDrawer}
      />
    );
  }

  // Inline tools -> render component directly in the bubble
  if (toolName === "search_nearby" || toolName === "search_by_location") {
    if (!isSearchData(response.data)) return null;
    return (
      <div className="max-w-[480px] rounded-2xl rounded-bl bg-card px-4 py-3">
        <NearbyBubble data={response.data} onSuggest={onSuggest} />
      </div>
    );
  }

  if (toolName === "clarify") {
    const clarifyData = isClarifyData(response.data) ? response.data : null;
    return (
      <div className="max-w-[480px] rounded-2xl rounded-bl bg-card px-4 py-3">
        <Clarification
          message={response.message}
          options={clarifyData?.options}
          candidates={clarifyData?.candidates}
          onSuggest={onSuggest}
        />
      </div>
    );
  }

  if (toolName === "answer_question" || toolName === "general_qa") {
    return null; // Text response is handled by text parts
  }

  // Non-visual tools (resolve_anime, greet_user) -> no UI
  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function asRuntimeResponse(output: unknown): RuntimeResponse | null {
  if (typeof output !== "object" || output === null) return null;
  const obj = output as Record<string, unknown>;
  if (typeof obj.intent !== "string") return null;
  if (typeof obj.message !== "string") return null;
  return obj as unknown as RuntimeResponse;
}

function getResultCount(response: RuntimeResponse): number {
  const data = response.data;
  if (isRouteData(data)) return data.route.point_count ?? data.route.ordered_points.length;
  if (isSearchData(data)) return data.results.row_count ?? data.results.rows.length;
  return 0;
}
