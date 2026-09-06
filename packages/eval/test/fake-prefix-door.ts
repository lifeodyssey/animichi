/**
 * A door that answers a seeding without a network, and counts what it was
 * asked (E-1 #1380).
 *
 * Named after what it constructs rather than after "fake" being a test noun:
 * this IS the `TurnDoor` port with `laneFetch`'s two rules (a path, never a
 * URL; one response) and none of its network. It is separate from
 * `fake-staging-door.ts` because that one scripts a CHAT turn — an SSE body and
 * a history payload — and a seeding is one JSON answer whose only interesting
 * property is how many times it was asked for.
 */
import type { TurnDoor } from "../src/staging-turn-task.ts";

/** One seeding request, as the door received it. */
export interface PrefixDoorCall {
  readonly path: string;
  readonly headers: Headers;
  readonly body: string;
}

/** What this door answers with; the default is one accepted seeding. */
export interface PrefixDoorScript {
  readonly status?: number;
  readonly body?: string;
}

export interface FakePrefixDoor {
  readonly door: TurnDoor;
  readonly calls: PrefixDoorCall[];
}

export function fakePrefixDoor(script: PrefixDoorScript = {}): FakePrefixDoor {
  const calls: PrefixDoorCall[] = [];
  const body = script.body ?? '{"session_id":"session-seeded","seeded":true}';
  const door: TurnDoor = (path, init) => {
    calls.push({
      path,
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? init.body : "",
    });
    return Promise.resolve(new Response(body, { status: script.status ?? 200 }));
  };
  return { door, calls };
}
