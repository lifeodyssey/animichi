/**
 * A door that answers without a network, and remembers what it was asked.
 *
 * Named after what it constructs rather than after "fake" being a test noun:
 * this IS the `TurnDoor` port, with `laneFetch`'s two rules (a path, never a
 * URL; one response) and none of its network.
 */
import type { TurnDoor } from "../src/staging-turn-task.ts";

/** One request the task made, as the door received it. */
export interface DoorCall {
  readonly path: string;
  readonly headers: Headers;
  readonly body: string;
}

export interface DoorScript {
  /** The SSE body `POST /v1/chat` answers with. */
  readonly stream: string;
  /** The `GET …/messages` payload. */
  readonly history: unknown;
  /** The session id the first chat answer names. */
  readonly sessionId?: string;
  /** How many chat posts are rejected before one is answered. */
  readonly rejectFirst?: number;
  /** Awaited INSIDE every chat post, so a test can hold turns in flight. */
  readonly settle?: () => Promise<void>;
}

export interface FakeStagingDoor {
  readonly door: TurnDoor;
  readonly calls: DoorCall[];
  /** The most turns that were ever open at the same moment. */
  peakInFlight(): number;
}

function recorded(path: string, init: RequestInit | undefined): DoorCall {
  return {
    path,
    headers: new Headers(init?.headers),
    body: typeof init?.body === "string" ? init.body : "",
  };
}

/** A door whose answers are a script, and whose traffic is a list. */
export function fakeStagingDoor(script: DoorScript): FakeStagingDoor {
  const calls: DoorCall[] = [];
  let rejectionsLeft = script.rejectFirst ?? 0;
  let inFlight = 0;
  let peak = 0;

  const chat = async (): Promise<Response> => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    try {
      await script.settle?.();
      if (rejectionsLeft > 0) {
        rejectionsLeft -= 1;
        throw new TypeError("fetch failed");
      }
      const headers = new Headers();
      if (script.sessionId !== undefined) headers.set("x-session-id", script.sessionId);
      return new Response(script.stream, { headers });
    } finally {
      inFlight -= 1;
    }
  };

  const door: TurnDoor = async (path, init) => {
    calls.push(recorded(path, init));
    if (path === "/v1/chat") return await chat();
    return Response.json(script.history);
  };

  return { door, calls, peakInFlight: () => peak };
}
