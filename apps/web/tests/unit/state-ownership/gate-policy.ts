/**
 * The state-ownership gate's policy: the standing exemptions and allowlists
 * that `checker.ts` enforces. The checker owns how a rule is applied; this
 * module owns which edges, boundaries, packages and files the rules name.
 */

/**
 * Cross-feature runtime edges that predate this gate. Every entry is one
 * "shared map primitive" hop: chat maps reuse `bubble-map` geometry/controller
 * (#842 documented exception), and bubble-map/map-spike both mount the shared
 * `maplibre-adapter` + map-style primitives. The #842 `src/lib/map/` extract
 * deletes this list. Paths are src-relative, extensionless. There is no
 * feature→UI list: shared UI primitives are themselves feature-owned — the
 * turnstile gate stays inside chat, and the magic-link login wall moved to the
 * independent `features/auth/ui` boundary (SHARED_UI_FEATURE) that any feature
 * may import, so no reverse edge needs an exemption.
 */
export const MAP_PRIMITIVE_EDGES: readonly string[] = [
  "features/chat/components/RouteTrailMap.tsx -> features/bubble-map/bubble-geometry",
  "features/chat/components/RouteTrailMap.tsx -> features/bubble-map/bubble-map-controller",
  "features/chat/components/SearchMap.tsx -> features/bubble-map/bubble-geometry",
  "features/chat/components/SearchMap.tsx -> features/bubble-map/bubble-map-controller",
  "features/chat/components/SearchResult.tsx -> features/bubble-map/bubble-map-controller",
  "features/bubble-map/bubble-map-controller.ts -> features/map-spike/map-style",
  "features/bubble-map/bubble-map-controller.ts -> features/maplibre/maplibre-adapter",
  "features/map-spike/map-controller.ts -> features/maplibre/maplibre-adapter",
];

/**
 * The independent auth feature's public UI boundary (`features/auth/ui`).
 * The magic-link login wall is shared by Landing and every chat/BYOK/error
 * surface (web structure spec: `components/auth/*` → `features/auth/ui/*`),
 * so any feature may import it; it remains a leaf feature — the generic
 * cross-feature rule still rejects auth importing another feature's internals.
 * `TurnstileGate` is deliberately not here: it stays chat-owned.
 */
export const SHARED_UI_FEATURE = "features/auth/ui";

export const RUNTIME_PACKAGE_IMPORTS = ["@orpc/client", "@orpc/openapi-client"];

/**
 * The only files allowed to touch `localStorage`/`sessionStorage`. Everything
 * is a named, typed, feature-owned adapter (under `lib/` or inside
 * `features/`) except `components/theme-bootstrap.ts`, which emits a
 * self-contained inline script for the document head that must run before any
 * module loads — its `localStorage` reference lives inside the emitted script
 * string.
 */
export const STORAGE_ADAPTERS: readonly string[] = [
  "lib/byok/byok-storage.ts",
  "lib/auth/save-failure-notice.ts",
  "features/chat/lib/draft-storage.ts",
  "features/chat/save/deferred-save.ts",
  "features/config/lib/theme-storage.ts",
  "lib/i18n/locale-storage.ts",
  "components/theme-bootstrap.ts",
];
