/**
 * The in-memory subscriber set of the alarm → SSE handoff contract (card #1252,
 * spec `docs/specs/2026-09-01-agent-ts-rewrite-spec.md` §三).
 *
 * "订阅者**不持久化**" is the whole point: this map lives in one Durable Object
 * incarnation's heap, and `fetch` and `alarm()` are two calls on that same
 * incarnation, which is the entire mechanism. A client that hangs up, or an
 * eviction, loses the live stream and nothing else — the loop writes to whoever
 * is still here and carries on. The client comes back to
 * `GET /v1/conversations/:id/messages`, which answers from Neon (§二's
 * disconnect semantics).
 *
 * A run may have more than one subscriber: the same conversation open in two
 * tabs is two `GET /stream` calls on one session instance. Delivery is
 * per-subscriber and best-effort, and a dead one is dropped on the write that
 * discovered it rather than on a heartbeat nobody would read.
 */
import { SseTurnChannel } from "./sse-turn-channel.ts";
import type { TurnFrame } from "./turn-frames.ts";

/** Where a running turn writes its frames. Best-effort by contract. */
export type TurnFrameSink = (frames: readonly TurnFrame[]) => Promise<void>;

export class TurnSubscribers {
  readonly #channels = new Map<string, SseTurnChannel[]>();
  /** The runs this incarnation has already closed out. Bounded by the turns one
   * incarnation drives, and heap-local like everything else here. */
  readonly #ended = new Set<string>();

  /**
   * Open one client's live view of one run, or refuse it.
   *
   * `stillOwed` is the caller's own check — the session's storage queue — and
   * it is taken as a promise IN FLIGHT rather than as a boolean on purpose.
   * `fetch` and `alarm()` interleave at every await, so the alarm can drive the
   * run to its ending while that read is outstanding, and the read then answers
   * "queued" about a turn that is already over. Settling it HERE puts the
   * decision and the registration in one uninterrupted step, which is the only
   * placement where a channel cannot be handed out after the turn that would
   * have terminated it ended (#1254).
   *
   * A refusal is not a loss: the client falls back to
   * `GET /v1/conversations/:id/messages`, which is where §二 says a turn it
   * missed is read from.
   */
  async openLiveView(runId: string, stillOwed: Promise<boolean>): Promise<SseTurnChannel | null> {
    if (!(await stillOwed) || this.#ended.has(runId)) return null;
    const channel = new SseTurnChannel();
    this.#channels.set(runId, [...this.#for(runId), channel]);
    return channel;
  }

  /** The sink one run's loop writes to; a dead subscriber is dropped here. */
  sinkFor(runId: string): TurnFrameSink {
    return async (frames) => {
      for (const frame of frames) await this.#broadcast(runId, frame);
      this.#dropGone(runId);
    };
  }

  /** Terminate every subscriber of one run and forget them. The state moves in
   * the synchronous prologue and the writing follows, because writing a
   * terminator awaits a reader: a view opened during that window would be one
   * this call has already walked past and will never come back to. */
  async finish(runId: string): Promise<void> {
    this.#ended.add(runId);
    const watching = this.#for(runId);
    this.#channels.delete(runId);
    for (const channel of watching) await channel.finish();
  }

  #for(runId: string): SseTurnChannel[] {
    return this.#channels.get(runId) ?? [];
  }

  async #broadcast(runId: string, frame: TurnFrame): Promise<void> {
    for (const channel of this.#for(runId)) await channel.send(frame);
  }

  #dropGone(runId: string): void {
    const live = this.#for(runId).filter((channel) => !channel.clientGone);
    this.#channels.set(runId, live);
  }
}
