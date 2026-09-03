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

  /** Register one client on one run and hand back the body it reads. */
  register(runId: string): SseTurnChannel {
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

  /** Terminate every subscriber of one run and forget them. */
  async finish(runId: string): Promise<void> {
    for (const channel of this.#for(runId)) await channel.finish();
    this.#channels.delete(runId);
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
