"use client";

import type { DynamicToolUIPart } from "ai";
import { isSearchData, isRouteData, isClarifyData } from "../../lib/types";
import type { RuntimeResponse } from "../../lib/types";
import { isVisualResponse } from "../generative/registry";
import { useSuggest } from "../../contexts/SuggestContext";
import { useDict } from "../../lib/i18n-context";
import { cn } from "../../lib/utils";
import { Skeleton } from "../ui/skeleton";
import NearbyBubble from "../generative/NearbyBubble";
import Clarification from "../generative/Clarification";
import ResultAnchor from "./ResultAnchor";

// ---------------------------------------------------------------------------
// PipelineCard — groups all tool parts into a single progress pipeline.
// ---------------------------------------------------------------------------

/** Tool names that produce visual results shown in the result panel. */
const VISUAL_TOOLS = new Set([
  "search_bangumi",
  "search_by_bangumi",
  "plan_route",
  "plan_selected",
]);

/** Tool names that should never appear in the pipeline.
 *  Includes PydanticAI structured output tools (*_response) that are
 *  internal to the agent and not meaningful pipeline steps. */
const SKIP_PIPELINE = new Set([
  "greet_user",
  "search_response",
  "clarify_response",
  "route_response",
  "qa_response",
  "greeting_response",
]);

// ---------------------------------------------------------------------------
// SVG Icons per tool
// ---------------------------------------------------------------------------

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5 14 14" />
    </svg>
  );
}

function MapPinIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 1.5A4.5 4.5 0 0 0 3.5 6c0 3.5 4.5 8.5 4.5 8.5s4.5-5 4.5-8.5A4.5 4.5 0 0 0 8 1.5Z" />
      <circle cx="8" cy="6" r="1.5" />
    </svg>
  );
}

function NavigateIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="currentColor">
      <polygon points="3,1.5 14.5,8 3,14.5 5.5,8" />
    </svg>
  );
}

function ChatBubbleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3h12v8H6l-3 2.5V11H2V3Z" />
    </svg>
  );
}

function QuestionIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="6" />
      <path d="M6 6.5a2 2 0 0 1 3.5 1.5c0 1-1.5 1.5-1.5 2.5" />
      <circle cx="8" cy="12" r="0.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4 12 12M12 4 4 12" />
    </svg>
  );
}

function renderToolIcon(toolName: string, className: string): React.ReactNode {
  switch (toolName) {
    case "resolve_anime":
      return <SearchIcon className={className} />;
    case "search_bangumi":
    case "search_by_bangumi":
    case "search_nearby":
    case "search_by_location":
      return <MapPinIcon className={className} />;
    case "plan_route":
    case "plan_selected":
      return <NavigateIcon className={className} />;
    case "clarify":
      return <QuestionIcon className={className} />;
    case "answer_question":
    case "general_qa":
      return <ChatBubbleIcon className={className} />;
    case "web_search":
      return <SearchIcon className={className} />;
    case "search_response":
      return <ChatBubbleIcon className={className} />;
    default:
      return <SearchIcon className={className} />;
  }
}

// ---------------------------------------------------------------------------
// Pipeline step state helpers
// ---------------------------------------------------------------------------

type StepState = "running" | "done" | "error" | "waiting";

function getStepState(part: DynamicToolUIPart): StepState {
  switch (part.state) {
    case "input-streaming":
    case "input-available":
      return "running";
    case "output-available":
      return "done";
    case "output-error":
      return "error";
    default:
      return "waiting";
  }
}

function getDoneValue(
  part: DynamicToolUIPart,
  dict: Record<string, string>,
): string {
  if (part.state !== "output-available") return "";
  const response = asRuntimeResponse(part.output);
  if (!response) return dict.value_done ?? "";

  const toolName = part.toolName;
  if (toolName === "resolve_anime") {
    return response.message || dict.value_done || "";
  }
  if (toolName === "search_bangumi" || toolName === "search_by_bangumi" || toolName === "search_nearby" || toolName === "search_by_location") {
    const count = getResultCount(response);
    return (dict.value_spots ?? "{count} spots").replace("{count}", String(count));
  }
  if (toolName === "plan_route" || toolName === "plan_selected") {
    const count = getResultCount(response);
    return (dict.value_route ?? "{count} stops").replace("{count}", String(count));
  }
  return dict.value_done ?? "";
}

// ---------------------------------------------------------------------------
// PipelineStep
// ---------------------------------------------------------------------------

function PipelineStep({
  part,
  thinkingDict,
}: {
  part: DynamicToolUIPart;
  thinkingDict: Record<string, string>;
}) {
  const stepState = getStepState(part);

  const runningLabel = thinkingDict[part.toolName] ?? part.toolName;
  const doneLabel = thinkingDict[`done_${part.toolName}`] ?? part.toolName;

  const iconClassName = cn(
    "h-3.5 w-3.5",
    stepState === "running" && "text-primary-fg",
    stepState === "done" && "text-primary",
    stepState === "error" && "text-error-fg",
    stepState === "waiting" && "text-muted-foreground",
  );

  return (
    <div className="flex items-start gap-2.5" data-testid={`pipeline-step-${part.toolName}`} data-state={stepState}>
      {/* Icon */}
      <span
        className={cn(
          "flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg",
          stepState === "running" && "bg-primary",
          stepState === "done" && "bg-primary/10",
          stepState === "error" && "bg-destructive/10",
          stepState === "waiting" && "bg-muted",
        )}
      >
        {renderToolIcon(part.toolName, iconClassName)}
      </span>

      {/* Content */}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-1">
        {stepState === "running" && (
          <>
            <span className="text-xs font-medium text-foreground">{runningLabel}</span>
            <Skeleton className="mt-0.5 h-[3px] w-20" />
          </>
        )}
        {stepState === "done" && (
          <div className="flex items-center gap-1.5">
            <div className="flex min-w-0 flex-col gap-0">
              <span className="text-[9px] leading-tight text-muted-foreground">{doneLabel}</span>
              <span className="truncate text-xs font-medium text-primary">
                {getDoneValue(part, thinkingDict)}
              </span>
            </div>
          </div>
        )}
        {stepState === "error" && (
          <span className="text-xs text-error-fg">
            {part.state === "output-error" ? part.errorText : part.toolName}
          </span>
        )}
        {stepState === "waiting" && (
          <span className="text-xs font-medium text-muted-foreground/50">
            {doneLabel}
          </span>
        )}
      </div>

      {/* Status indicator */}
      {stepState === "done" && (
        <CheckIcon className="mt-1.5 h-3.5 w-3.5 shrink-0 text-primary" />
      )}
      {stepState === "error" && (
        <XIcon className="mt-1.5 h-3.5 w-3.5 shrink-0 text-error-fg" />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PipelineConnector
// ---------------------------------------------------------------------------

function PipelineConnector({ done }: { done: boolean }) {
  return (
    <div
      className={cn("ml-[14px] h-2 w-0.5", done ? "bg-primary" : "bg-muted")}
      aria-hidden="true"
    />
  );
}

// ---------------------------------------------------------------------------
// PipelineCard — public component that renders the full pipeline
// ---------------------------------------------------------------------------

interface PipelineCardProps {
  parts: DynamicToolUIPart[];
  messageId: string;
  onActivate?: (messageId: string) => void;
  isActive?: boolean;
  onOpenDrawer?: () => void;
}

export function PipelineCard({
  parts,
  messageId,
  onActivate,
  isActive = false,
  onOpenDrawer,
}: PipelineCardProps) {
  const { thinking: thinkingDict, chat: chatDict } = useDict();
  const suggest = useSuggest();

  // Filter out greet_user — it has no pipeline UI
  const pipelineParts = parts.filter((p) => !SKIP_PIPELINE.has(p.toolName));

  // Separate pipeline-only parts from inline-renderable parts
  const inlineParts: DynamicToolUIPart[] = [];
  const stepParts: DynamicToolUIPart[] = [];
  const anchorParts: DynamicToolUIPart[] = [];

  for (const part of pipelineParts) {
    const toolName = part.toolName;
    if (part.state === "output-available") {
      const response = asRuntimeResponse(part.output);
      // Inline: clarify, nearby, answer_question renders directly
      if (toolName === "clarify" || toolName === "search_nearby" || toolName === "search_by_location") {
        inlineParts.push(part);
        stepParts.push(part);
        continue;
      }
      // Visual tools with output -> produce an anchor AND a step
      if (VISUAL_TOOLS.has(toolName) && response && isVisualResponse(response)) {
        anchorParts.push(part);
        stepParts.push(part);
        continue;
      }
      // answer_question / general_qa: no UI (text parts handle it)
      if (toolName === "answer_question" || toolName === "general_qa") {
        stepParts.push(part);
        continue;
      }
    }
    // All other states (running, error, waiting, non-visual done)
    stepParts.push(part);
  }

  return (
    <>
      {/* Pipeline card */}
      {stepParts.length > 0 && (
        <div className="max-w-[320px] rounded-2xl rounded-bl bg-card p-4" data-testid="pipeline-card">
          <div className="flex flex-col">
            {stepParts.map((part, i) => (
              <div key={part.toolCallId}>
                {i > 0 && (
                  <PipelineConnector done={getStepState(stepParts[i - 1]) === "done"} />
                )}
                <PipelineStep
                  part={part}
                  thinkingDict={thinkingDict as unknown as Record<string, string>}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Inline tool outputs */}
      {inlineParts.map((part) => {
        if (part.state !== "output-available") return null;
        return (
          <InlineToolOutput
            key={part.toolCallId}
            part={part}
            onSuggest={suggest}
          />
        );
      })}

      {/* Result anchors */}
      {anchorParts.map((part) => {
        if (part.state !== "output-available") return null;
        const response = asRuntimeResponse(part.output);
        if (!response) return null;
        const count = getResultCount(response);
        return (
          <ResultAnchor
            key={part.toolCallId}
            label={(chatDict.anchor_results ?? "").replace("{count}", String(count))}
            subtitle={chatDict.tap_to_view ?? ""}
            messageId={messageId}
            onActivate={onActivate}
            isActive={isActive}
            onOpenDrawer={onOpenDrawer}
          />
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// InlineToolOutput — renders inline components (clarify, nearby)
// ---------------------------------------------------------------------------

function InlineToolOutput({
  part,
  onSuggest,
}: {
  part: DynamicToolUIPart;
  onSuggest: (text: string) => void;
}) {
  if (part.state !== "output-available") return null;
  const response = asRuntimeResponse(part.output);
  if (!response) return null;

  if (part.toolName === "search_nearby" || part.toolName === "search_by_location") {
    if (!isSearchData(response.data)) return null;
    return (
      <div className="max-w-[480px] rounded-2xl rounded-bl bg-card px-4 py-3">
        <NearbyBubble data={response.data} onSuggest={onSuggest} />
      </div>
    );
  }

  if (part.toolName === "clarify") {
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

  return null;
}

// ---------------------------------------------------------------------------
// Legacy default export — single tool part renderer (kept for backward compat)
// ---------------------------------------------------------------------------

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
  return (
    <PipelineCard
      parts={[part]}
      messageId={messageId}
      onActivate={onActivate}
      isActive={isActive}
      onOpenDrawer={onOpenDrawer}
    />
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function asRuntimeResponse(output: unknown): RuntimeResponse | null {
  if (typeof output !== "object" || output === null) return null;
  const obj = output as Record<string, unknown>;

  // Legacy format: output already has intent field
  if (typeof obj.intent === "string" && typeof obj.message === "string") {
    return obj as unknown as RuntimeResponse;
  }

  // PydanticAI raw tool output: search_bangumi returns {rows, row_count}
  if (Array.isArray(obj.rows)) {
    return {
      success: true,
      status: "ok",
      intent: "search_bangumi",
      message: "",
      data: { results: { rows: obj.rows as object[], row_count: (obj.row_count as number) ?? (obj.rows as unknown[]).length } },
    } as RuntimeResponse;
  }

  // PydanticAI raw tool output: plan_route returns {ordered_points, ...}
  if (Array.isArray(obj.ordered_points)) {
    return {
      success: true,
      status: "ok",
      intent: "plan_route",
      message: "",
      data: { route: obj },
    } as RuntimeResponse;
  }

  return null;
}

function getResultCount(response: RuntimeResponse): number {
  const data = response.data;
  if (isRouteData(data)) return data.route.point_count ?? data.route.ordered_points.length;
  if (isSearchData(data)) return data.results.row_count ?? data.results.rows.length;
  return 0;
}
