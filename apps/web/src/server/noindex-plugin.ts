import { type H3Event, setResponseHeader } from "h3";
import type { NitroAppPlugin, NitroRuntimeHooks } from "nitropack/types";

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
//     runs, h3 1.15.11) skips beforeResponse, so a staging 5xx page ships
//     without the header. Search engines do not index 5xx, so this is recorded
//     rather than fixed. Unhandled errors DO reach the hook.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readAppEnv(event: H3Event): unknown {
  // The cloudflare-module preset spreads { cloudflare: { env } } into the
  // event context (nitropack/dist/presets/cloudflare/runtime/_module-handler.mjs).
  const context: Record<string, unknown> = event.context;
  const cloudflare = context.cloudflare;
  if (!isRecord(cloudflare)) return undefined;
  return isRecord(cloudflare.env) ? cloudflare.env.APP_ENV : undefined;
}

function applyNoindexHeader(event: H3Event): void {
  if (readAppEnv(event) === "production") return;
  setResponseHeader(event, "X-Robots-Tag", "noindex, nofollow");
}

type NoindexHookHost = {
  hooks: {
    hook: (name: "beforeResponse", callback: NitroRuntimeHooks["beforeResponse"]) => unknown;
  };
};

export function registerNoindexHook(nitroApp: NoindexHookHost): void {
  nitroApp.hooks.hook("beforeResponse", applyNoindexHeader);
}

// defineNitroPlugin is the identity function in nitropack 2.13.4; typing the
// export directly keeps nitropack's runtime barrel out of the unit-test pool.
const noindexPlugin: NitroAppPlugin = registerNoindexHook;
export default noindexPlugin;
