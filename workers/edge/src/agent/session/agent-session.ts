/// <reference types="@cloudflare/workers-types" />

/**
 * The `AgentSession` Durable Object — one instance per session, and the place a
 * turn actually runs (card #1252, spec
 * `docs/specs/2026-09-01-agent-ts-rewrite-spec.md` §二/§三).
 *
 * WHY THE TURN RUNS IN `alarm()` AND NOT IN `fetch`: a fetch's wall time is
 * unbounded only while the CALLER stays connected — Cloudflare may cancel the
 * associated work once it hangs up — whereas an `alarm()` handler owns its own
 * 15-minute wall clock, independent of any connection. That is the binding
 * decision of §二, and it is why hanging up cannot stop a turn.
 *
 * The two calls this class answers are two halves of the same contract:
 * - `POST /arm` writes the run id into STORAGE and arms `setAlarm(now)`. The
 *   intake calls it after its transaction commits, and the singleton
 *   `RunSweeper` calls it again for anything stranded; both are idempotent
 *   because the lease decides, not the wake-up (§三).
 * - `GET /stream?runId=` registers an in-memory subscriber and hands back an
 *   SSE body. `fetch` and `alarm()` run on the same incarnation and share its
 *   heap, which is the entire handoff mechanism; subscribers are not persisted,
 *   so an eviction costs the live view and nothing else.
 *
 * A plain Durable Object class, like `EdgeGuard` and `RunSweeper`: no
 * `cloudflare:workers` import, so every module it reaches stays importable
 * under `node:test`.
 */
import { driveQueuedRun } from "./session-turn.ts";
import { SessionRunQueue } from "./session-run-queue.ts";
import { armedRunId, SESSION_ARM_PATH } from "./session-wakeup.ts";
import { sseResponse } from "./sse-turn-channel.ts";
import { TurnSubscribers } from "./turn-subscribers.ts";

/** Where a connected client reads one run's live frames. */
export const SESSION_STREAM_PATH = "/stream";

function notFound(): Response {
  return new Response("Not found", { status: 404 });
}

export class AgentSession {
  readonly #ctx: DurableObjectState;
  readonly #env: Record<string, unknown>;
  readonly #queue: SessionRunQueue;
  readonly #subscribers = new TurnSubscribers();

  constructor(ctx: DurableObjectState, env: Record<string, unknown>) {
    this.#ctx = ctx;
    this.#env = env;
    this.#queue = new SessionRunQueue(ctx.storage);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === SESSION_ARM_PATH) return await this.#arm(request);
    if (url.pathname === SESSION_STREAM_PATH) return this.#stream(url);
    return notFound();
  }

  /** One alarm drains every run this session was armed for. A run stays queued
   * until it is driven, so the platform's retry finds it again. */
  async alarm(): Promise<void> {
    for (const runId of await this.#queue.pending()) {
      await this.#drive(runId);
      await this.#queue.dequeue(runId);
    }
  }

  async #arm(request: Request): Promise<Response> {
    const runId = await armedRunId(request);
    if (runId === undefined) return new Response("Bad request", { status: 400 });
    await this.#queue.queue(runId);
    await this.#ctx.storage.setAlarm(Date.now());
    return new Response(null, { status: 204 });
  }

  #stream(url: URL): Response {
    const runId = url.searchParams.get("runId");
    if (runId === null || runId === "") return notFound();
    return sseResponse(this.#subscribers.register(runId).body);
  }

  /** One run, then close whoever was watching it. */
  async #drive(runId: string): Promise<void> {
    const emit = this.#subscribers.sinkFor(runId);
    await driveQueuedRun({ env: this.#env, emit, owner: this.#ctx.id.toString() }, runId);
    await this.#subscribers.finish(runId);
  }
}
