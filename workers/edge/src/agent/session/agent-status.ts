/**
 * The `<agent_status>` bar every model request ends with (card #1379, spec
 * `docs/specs/2026-09-01-agent-ts-rewrite-spec.md` §九 9.3).
 *
 * These lines used to be the system prompt's `## Trusted runtime context`
 * block, rebuilt per turn from the envelope (#1280, #1290). 李博杰《深入理解 AI
 * Agent》ch.2 实验 2-3 names that shape — 动态系统提示词 — as the most common
 * context-management mistake: a prefix that changes between turns throws away
 * the Prompt Cache for everything after the first differing token, and the
 * prompt is the very first thing in the context.
 *
 * WHY A `user` MESSAGE AT THE END. The book's 「Agent 状态栏在上下文中的具体位置」
 * is explicit that the bar rides "一条 user 角色的消息" appended to the end of the
 * context rather than a rewritten `system` message: last is where the attention
 * weight is, and appending leaves every cached token before it intact. The
 * `user` role is a SLOT the harness borrows, not a claim that a user typed this
 * — which is why the poisoning defence is unchanged from when these same lines
 * rode the system channel: values still arrive sanitised by `trusted-text.ts`
 * (both ledgers apply it on write) and a retained entity is still wrapped in
 * `「」` so a value engineered to read as trailing instruction text cannot blend
 * into the directive after it.
 *
 * REPLACED EVERY REQUEST, NEVER PERSISTED — the book's 「状态更新的两种实现与缓存
 * 代价」实现一. `turn-agent.ts` renders it inside `transformContext`, which pi
 * calls on the way into each model request and whose result never re-enters the
 * agent's own message list; `messages` in Neon never sees it either. So exactly
 * one bar exists in any context, it is always the newest state — a tool that
 * resolves the anime mid-turn is on the NEXT request's bar — and the only cache
 * it invalidates is the suffix since the previous request. 实现二（持久追加,
 * Claude Code's `<system-reminder>`) is the wrong trade here: this tier rebuilds
 * the transcript from Neon on every alarm, so stale bars would accumulate in the
 * context without ever earning the append-only cache benefit.
 *
 * MAINTAINED BY CODE ONLY. The book's first caution — 「状态栏尽量用代码维护……
 * 绝不要让它一次性批量统计」, because 「模型几乎无条件地相信状态栏」 — and the
 * facts here were already code-derived (`fact-ledger.ts`: a fact is a thing a
 * tool was called with, never a thing a model said). No summarisation step may
 * be added to this path.
 *
 * It names no tool for the same reason `turn-instructions.ts` names none: the
 * tools are #1253's and their routing table is theirs to write.
 */
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { FactLedger, SceneReferenceRecord } from "../memory/fact-ledger.ts";
import type { RetainedEntityLedger } from "../memory/retained-entity-ledger.ts";
import type { PendingClarification, SessionEnvelope } from "./session-envelope.ts";
import type { CurrentAnime } from "../tools/catalog-tool-session.ts";

/**
 * Where the bar reads the session's own state. `TurnCatalogSession` fulfils it,
 * and the read is LIVE on purpose: the tools answer a new envelope as the turn
 * runs, so a value captured when the turn opened would be stale by the second
 * model request.
 */
export interface TurnStatusSource {
  readonly envelope: SessionEnvelope;
}

/** Everything one request's bar is rendered from. */
export interface TurnStatus {
  readonly envelope: SessionEnvelope;
  /** The tools THIS run has already called, in the order they ran. */
  readonly toolCalls: readonly string[];
}

/** The work the session is about, so the next turn does not resolve it again. */
function resolvedAnimeLine(anime: CurrentAnime): string {
  return `Current anime: ${anime.title} (${anime.bangumiId}). It is already resolved for this session; use that id rather than resolving the title again.`;
}

/**
 * The question an earlier turn asked, which the user's message may answer.
 *
 * The clarification's own id is deliberately NOT on this line. #1288 gave the
 * envelope one (`PendingClarification.id`) because a selection path now exists
 * to stale-guard, but it is a fact for the CLIENT and the server's validator,
 * not for the model: the model neither mints it nor may quote it back, and a
 * number in the context is a number a model can invent.
 */
function openQuestionLine(pending: PendingClarification): string {
  const ids = pending.candidates.map((candidate) => candidate.id).join(", ");
  return `Open question: ${pending.reason}; candidate_ids=[${ids}]. The user's message may be answering it.`;
}

/**
 * The fact ledger's own consumption point (#1290) — the port of Python's
 * `_fact_ledger_context`, word for word, because a ledger field with no
 * consumer is dead scaffolding and this is the consumer.
 */
function factLines(ledger: FactLedger): string[] {
  const constraint = ledger.activeHardConstraint();
  const pacing = constraint === null ? [] : [
    `User hard constraint: ${constraint.value} pacing. Apply this pacing to every subsequent plan_route call unless the user explicitly changes it.`,
  ];
  return [...pacing, ...ledger.activeSceneReferences().map(sceneLine)];
}

function sceneLine(reference: SceneReferenceRecord): string {
  return `Referenced scene: ${reference.value}. The user explicitly selected this; treat it as a durable point of interest for follow-up questions this session.`;
}

/**
 * What compaction rescued before it shrank the return that carried it (#1290),
 * Python's `_compaction_retention_context`.
 *
 * The value is wrapped in `「」` rather than concatenated bare onto the sentence,
 * so a value engineered to read as trailing instruction text cannot blend into
 * the directive that follows it.
 */
function retentionLines(ledger: RetainedEntityLedger): string[] {
  return ledger.entities.map(
    (entity) =>
      `Verbatim entity retained from an earlier ${entity.toolName} call: 「${entity.value}」. This was compacted out of the raw conversation; still treat it as valid context for anaphora and follow-up.`,
  );
}

/** How many times each tool ran, in the order each was first called. */
function callCounts(toolCalls: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const name of toolCalls) counts.set(name, (counts.get(name) ?? 0) + 1);
  return counts;
}

/**
 * The book's 工具调用计数器: the count the model would otherwise have to
 * re-derive by scanning the trajectory, handed to it already computed. It is
 * read off this run's settled steps, so a replayed step counts once.
 */
function toolCallLines(toolCalls: readonly string[]): string[] {
  if (toolCalls.length === 0) return [];
  const spelled = [...callCounts(toolCalls)].map(([name, count]) => `${name} ×${String(count)}`);
  return [`Tool calls this turn: ${spelled.join(", ")}.`];
}

/** Everything the session knows, one line each, in Python's order. */
function statusLines(status: TurnStatus): string[] {
  const { currentAnime, pendingClarification, memory } = status.envelope;
  const facts: string[] = [];
  if (currentAnime !== null) facts.push(resolvedAnimeLine(currentAnime));
  if (pendingClarification !== null) facts.push(openQuestionLine(pendingClarification));
  return [...facts, ...factLines(memory.facts), ...retentionLines(memory.retainedEntities),
    ...toolCallLines(status.toolCalls)];
}

/** The tag the model recognises the bar by, and the tests assert on. */
export const AGENT_STATUS_TAG = "agent_status";

/**
 * The bar as the request's context ends with it: ONE message, or none at all
 * when a session that has done nothing yet has nothing to vouch for — an empty
 * bar would spend tokens and attention saying so.
 */
export function agentStatusMessages(status: TurnStatus): AgentMessage[] {
  const lines = statusLines(status);
  if (lines.length === 0) return [];
  const content = `<${AGENT_STATUS_TAG}>\n${lines.join("\n")}\n</${AGENT_STATUS_TAG}>`;
  return [{ role: "user", content, timestamp: 0 }];
}
