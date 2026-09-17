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
// Two h3 generations, one plugin. The built Worker runs nitro 2.13, whose
// runtime events are h3 1.15; this package's own h3 is 2.x and the unit
// harness serves the plugin through an h3 2 app. The hook therefore reads
// only the shared slice of the event — `context` is an open record in both
// generations, and `cloudflare` is the one entry the decision needs — and the
// header write goes through writeHeader's shape boundary instead of either
// generation's spelled-out accessor.

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

/** Write a response header on whichever response surface the event carries.
 *
 * h3 2 events hold the outgoing response in `event.res.headers` (live web
 * Headers). nitro 2.13's h3 1.15 events have no response store — they reach
 * the wire through the node adapter (`event.node.res.setHeader`), which is
 * exactly the path h3 1.15's own `setResponseHeader` took. Discriminate on the
 * shape, never on a version sniff, and fail loud when neither surface exists:
 * a silently dropped header is this plugin's cardinal failure.
 */
/** The h3 2 response store when the event carries one, else undefined. */
function webStoreHeaders(event: HookEvent): Headers | undefined {
  const res = (event as { res?: { headers?: unknown } }).res;
  return res?.headers instanceof Headers ? res.headers : undefined;
}

/** The node adapter both nitro's h3 1.15 events and the fail-loud floor. */
function nodeAdapter(event: HookEvent, name: string): { setHeader(name: string, value: string): void } {
  const adapter = (event as { node?: { res?: { setHeader(name: string, value: string): void } } }).node?.res;
  if (adapter === undefined) {
    throw new Error(`noindex-plugin: event carries neither an h3 2 response store nor a node adapter (${name})`);
  }
  return adapter;
}

function writeHeader(event: HookEvent, name: string, value: string): void {
  const headers = webStoreHeaders(event);
  if (headers !== undefined) {
    headers.set(name, value);
    return;
  }
  nodeAdapter(event, name).setHeader(name, value);
}

function applyNoindexHeader(event: HookEvent): void {
  if (readAppEnv(event) === "production") return;
  writeHeader(event, "X-Robots-Tag", "noindex, nofollow");
}

interface NoindexHookHost {
  hooks: {
    hook: (name: "beforeResponse", callback: (event: HookEvent) => void | Promise<void>) => unknown;
  };
}

export function registerNoindexHook(nitroApp: NoindexHookHost): void {
  nitroApp.hooks.hook("beforeResponse", applyNoindexHeader);
}

// defineNitroPlugin is the identity function in nitropack 2.13.4; typing the
// export directly keeps nitropack's runtime barrel out of the unit-test pool.
const noindexPlugin: NitroAppPlugin = registerNoindexHook;
export default noindexPlugin;
