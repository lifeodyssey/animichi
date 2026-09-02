// W0-S4 spike (#1247): the in-memory subscriber set of the alarm → SSE handoff
// contract (spec §三).
//
// "订阅者**不持久化**" is the whole point: this map lives in one Durable Object
// incarnation's heap. A client that hangs up, or an eviction, loses the live
// stream and nothing else — the loop writes to whoever is still here and carries
// on. The client comes back to `GET /runs/:id`, which answers from Neon.

import { SseTurnChannel } from "./sse-turn-channel.ts";
import type { TurnEventSink } from "./turn-parts.ts";

export class TurnSubscribers {
  private readonly channels = new Map<string, SseTurnChannel>();

  register(runId: string): SseTurnChannel {
    const channel = new SseTurnChannel();
    this.channels.set(runId, channel);
    return channel;
  }

  /** Best-effort: no subscriber, or a dead one, never stalls the loop. */
  sinkFor(runId: string): TurnEventSink {
    return async (event, data) => {
      await this.channels.get(runId)?.send(event, data);
    };
  }

  async close(runId: string): Promise<void> {
    await this.channels.get(runId)?.close();
    this.channels.delete(runId);
  }
}
