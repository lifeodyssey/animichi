/// <reference types="@cloudflare/workers-types" />

/**
 * Waking the `AgentSession` Durable Object that owns one session, which is how
 * a committed run starts running (spec `docs/specs/2026-09-01-agent-ts-rewrite-spec.md`
 * §三: "事务提交后 `setAlarm(now)` 叫醒该 session 的 DO").
 *
 * This module owns the CALLER's half of that hop only. The AgentSession class
 * itself is card #1252; what it must implement is the request `armRequest`
 * builds — `POST /arm` with a JSON `{"runId"}` body, answered by arming the
 * instance's own alarm — and `armedRunId` is that contract read from the other
 * side. The hop is a stub `fetch` rather than an RPC method for the same
 * reason `EdgeGuard` is: every module here stays importable under `node:test`,
 * which cannot resolve `cloudflare:workers`.
 */
import { isJsonRecord } from "../json-record.ts";
import type { NamedStubs } from "../durable-namespace.ts";
import type { RunBackstop } from "../sweeper/run-backstop.ts";

/** The one thing anything does to a session: arm it to run a committed turn. */
export interface SessionWakeup {
  arm(sessionId: string, runId: string): Promise<void>;
}

/** The path an arm request carries. */
export const SESSION_ARM_PATH = "/arm";

/** The arm request #1252's `AgentSession.fetch` must answer. */
export function armRequest(runId: string): Request {
  return new Request(`https://agent-session${SESSION_ARM_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runId }),
  });
}

/** The run id an arm request names, or `undefined` when it names none. */
export async function armedRunId(request: Request): Promise<string | undefined> {
  const payload: unknown = await request.json();
  if (!isJsonRecord(payload)) return undefined;
  const runId = payload.runId;
  return typeof runId === "string" && runId.length > 0 ? runId : undefined;
}

/**
 * The production wake-up. Two independent things happen, and they are ISSUED
 * together rather than sequenced: arming the session is the fast path, and
 * keeping the singleton sweeper's alarm alive is the backstop that covers the
 * fast path failing. Neither is a precondition of the other, so a rejection in
 * one must not cancel the other — and both surface to the caller.
 *
 * Bootstrapping the backstop from here is a deliberate addition to spec §三,
 * which names the sweeper's periodic alarm but not who first arms it: a
 * Durable Object alarm does not exist until something schedules it, and this
 * Worker has no cron trigger. `RunBackstop.ensureScheduled` is idempotent and
 * writes nothing once the sweeper is ticking (`RunSweeper.fetch`).
 */
export function durableSessionWakeup(sessions: NamedStubs, backstop: RunBackstop): SessionWakeup {
  return {
    async arm(sessionId, runId) {
      const armed = sessions.get(sessions.idFromName(sessionId)).fetch(armRequest(runId));
      await Promise.all([armed, backstop.ensureScheduled()]);
    },
  };
}
