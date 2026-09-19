import type { NitroAppPlugin } from "nitropack/types";

// Nitro runtime plugin: staging/preview must never become the canonical site
// while animichi.com has no DNS (issue #538), so every response from a
// non-production Worker carries X-Robots-Tag. Fail-safe direction: only an
// explicit APP_ENV === "production" (a wrangler var, set per env block in
// wrangler.jsonc) suppresses the header — missing/empty/unknown means noindex.
//
// Two coverage notes, both measured rather than assumed:
//   • Responses served straight off the ASSETS binding never reach the Worker,
//     so static files do not get the header. All HTML is Worker-rendered, so
//     canonicalisation is covered; static assets are the account-layer's job.
//   • A *handled* error (nitro's errorHandler marks it handled before the hook
//     runs) skips beforeResponse, so a staging 5xx page ships without the
//     header. Search engines do not index 5xx, so this is recorded rather than
//     fixed. Unhandled errors DO reach the hook.
//
// Two h3 generations, one plugin, and one measured difference between them
// (#1744). The built Worker runs nitro 2.13, whose hook forwards h3 1.15's
// `onBeforeResponse(event, response)` — and h3 1.15's response argument is a
// body-only wrapper, with headers written through `event.node.res`. Under h3 2
// the hook fires from `onResponse(response, event)`, i.e. after h3 2 built the
// response and emptied the event's own store (`prepareResponse` sets the event's
// response slot to undefined first), so a write to `event.res.headers` there
// reaches nothing: the plugin would keep running while its header silently
// stopped shipping. The hook therefore reads only the shared slice of the event
// — `context` is an open record in both generations, and `cloudflare` is the one
// entry the decision needs — and writeHeader prefers the response the hook is
// handed, then the event's own store (live only for a pre-response hook), then
// the node adapter, failing loud when a runtime offers none of the three.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The event surface the hook reads: the slice both h3 generations share. */
interface HookEvent {
  context: { cloudflare?: unknown; [key: string]: unknown };
}

function readAppEnv(event: HookEvent): unknown {
  // The cloudflare-module preset spreads { cloudflare: { env } } into the
  // event context (nitropack/dist/presets/cloudflare/runtime/_module-handler.mjs).
  const cloudflare = event.context.cloudflare;
  if (!isRecord(cloudflare)) return undefined;
  return isRecord(cloudflare.env) ? cloudflare.env.APP_ENV : undefined;
}

/** The hook's second argument: h3 2's built response, or h3 1.15's `{ body }`.
 *
 * Deliberately unconstrained: `{ headers?: unknown }` would be a weak type, and
 * `{ body }` — what h3 1.15 hands the same hook — has no property in common with
 * it, so a nitro hook store typed that way could not be registered against. The
 * write path sniffs the surface it needs at runtime instead.
 */
type HookResponse = unknown;

/** The Headers a write can reach, in the order a runtime makes one live: the
 *  response the hook was handed (h3 2 builds the response before it calls
 *  `onResponse`, so this is the one that still reaches the wire), then the
 *  event's own store (live only for a hook that runs BEFORE the response is
 *  built). h3 1.15 events carry neither.
 */
function writableHeaders(event: HookEvent, response: HookResponse): Headers | undefined {
  const handed = isRecord(response) ? response.headers : undefined;
  if (handed instanceof Headers) return handed;
  const res = (event as { res?: { headers?: unknown } }).res;
  return res?.headers instanceof Headers ? res.headers : undefined;
}

/** The node adapter, which is both nitro's h3 1.15 surface and the floor. */
function nodeAdapter(event: HookEvent, name: string): { setHeader(name: string, value: string): void } {
  const adapter = (event as { node?: { res?: { setHeader(name: string, value: string): void } } }).node?.res;
  if (adapter === undefined) {
    throw new Error(
      `noindex-plugin: event carries no writable response surface for ${name}` +
        " (hook response, h3 2 event store, node adapter)",
    );
  }
  return adapter;
}

/** Write a header on whichever response surface the hook carries: h3 2's built
 *  response, h3 2's pre-response event store, or h3 1.15's node adapter —
 *  `event.node.res.setHeader`, the path h3 1.15's own `setResponseHeader` took
 *  and the one the shipped Worker uses. Discriminate on the shape, never on a
 *  version sniff, and fail loud when a runtime offers none of the three: a
 *  silently dropped header is this plugin's cardinal failure.
 */
function writeHeader(event: HookEvent, response: HookResponse, name: string, value: string): void {
  const headers = writableHeaders(event, response);
  if (headers !== undefined) {
    headers.set(name, value);
    return;
  }
  nodeAdapter(event, name).setHeader(name, value);
}

function applyNoindexHeader(event: HookEvent, response?: HookResponse): void {
  if (readAppEnv(event) === "production") return;
  writeHeader(event, response, "X-Robots-Tag", "noindex, nofollow");
}

interface NoindexHookHost {
  hooks: {
    hook: (
      name: "beforeResponse",
      callback: (event: HookEvent, response?: HookResponse) => void | Promise<void>,
    ) => unknown;
  };
}

export function registerNoindexHook(nitroApp: NoindexHookHost): void {
  nitroApp.hooks.hook("beforeResponse", applyNoindexHeader);
}

// defineNitroPlugin is the identity function in nitropack 2.13.4; typing the
// export directly keeps nitropack's runtime barrel out of the unit-test pool.
const noindexPlugin: NitroAppPlugin = registerNoindexHook;
export default noindexPlugin;
