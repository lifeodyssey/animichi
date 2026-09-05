/**
 * The short form a long tool return is replayed as, decided ONCE at the moment
 * the step is written (card #1378, spec §九 9.2).
 *
 * 李博杰《深入理解 AI Agent》ch.2「缓存作为架构约束」:「工具结果的替换字符串在
 * 首次出现时就被冻结……即使后续会话重启，系统也会使用完全相同的替换字符串——以
 * 保证恢复后的消息序列与缓存中的字节流一致」. So the decision is taken where the
 * step is persisted (`turn-step.ts`) and stored beside the raw result in
 * `run_steps.result`, rather than recomputed by whoever reads the row back.
 *
 * NOTHING RE-SUMMARISES ON THE READ PATH, and that absence is load-bearing. A
 * summariser running there would re-decide the bytes on every alarm and on
 * every deploy that touched `tool-return-summary.ts`, which is exactly the
 * instability the freeze exists to remove. A result with no frozen summary —
 * one short enough to keep, or a row written before the freeze existed —
 * therefore replays VERBATIM: the raw `content` is intact either way (spec §三:
 * `run_steps` is append-only and never rewritten), so the fallback is the truth
 * rather than a second guess at it.
 *
 * THIS RUN'S OWN STEPS REPLAY VERBATIM TOO. Only 早先一轮 replays as its frozen
 * summary (spec §九 9.1); a retried alarm re-seeds the steps its own earlier
 * attempt executed, and that attempt handed the model the full return. Showing
 * the summary instead would make a retry's context differ from the attempt it
 * is meant to resume. A return shrinks at the turn boundary, and exactly once.
 */
import { TOOL_RETURN_MAX_CHARS, toolReturnSummary } from "./tool-return-summary.ts";
import type { StepContent, StepResult } from "./turn-store.ts";

/** What the tool answered, as the one string both the cap and the summariser
 * read. Only text is ever shrunk; an image carries no summary. */
function returnTextOf(content: readonly StepContent[]): string {
  return content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

/**
 * Whether this text ALREADY is a frozen short form of that tool's return.
 *
 * The summariser's own output is the marker, so there is no second one to keep
 * in step: every line it writes opens `[<toolName>: `, and a return it has not
 * touched is the tool's own JSON, which cannot. A separate `[compacted]`-style
 * prefix would have to be applied by every writer and respected by every
 * reader — and the one that forgot would re-summarise a summary, which parses
 * as nothing and collapses to the generic line, taking an ambiguous resolve's
 * ordered candidate ids with it.
 */
function isFrozenSummary(toolName: string, text: string): boolean {
  return text.startsWith(`[${toolName}: `);
}

/**
 * The summary this return is frozen with, or nothing when there is none to
 * take: a return short enough to be carried in full for the rest of the
 * session, or one that IS already its own short form.
 *
 * This is the single decision. The write path takes it as a step settles and
 * the threshold pass takes it again over the live context, so "what is this
 * return's short form" has one answer wherever it is asked — and asking twice
 * answers the same thing, which is what makes the pass a fixpoint.
 */
export function frozenSummaryOf(
  toolName: string, content: readonly StepContent[],
): string | undefined {
  const text = returnTextOf(content);
  if (text.length <= TOOL_RETURN_MAX_CHARS || isFrozenSummary(toolName, text)) return undefined;
  return toolReturnSummary(toolName, text);
}

/** How a settled step's result is re-clothed for the model. */
export type ReplayedContent = (result: StepResult) => StepContent[];

/** Verbatim: what THIS run's own replayed steps show a retried alarm. */
export const verbatimReturn: ReplayedContent = (result) => [...result.content];

/**
 * The frozen summary in place of the text, images untouched: what an earlier
 * turn's return shows.
 *
 * `details` is deliberately left whole. pi's OpenAI-completions adapter puts
 * only `content`'s text on the wire (`dist/api/openai-completions.js` builds
 * the tool message from `toolMsg.content` alone), so `details` is a local
 * sidecar this tier reads for its own frames and rows — shrinking it would save
 * the model nothing and cost the server the outcome it answers from.
 */
export const frozenReturn: ReplayedContent = (result) =>
  result.summary === undefined
    ? [...result.content]
    : [{ type: "text", text: result.summary }, ...result.content.filter((part) => part.type !== "text")];
