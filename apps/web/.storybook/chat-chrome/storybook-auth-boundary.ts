import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

const STUB = fileURLToPath(new URL("./auth-session.stub.ts", import.meta.url));
const GEO_STUB = fileURLToPath(new URL("./geo.stub.ts", import.meta.url));
const START_STUB = fileURLToPath(new URL("./react-start.stub.ts", import.meta.url));
const MAGIC_LINK_STUB = fileURLToPath(new URL("./magic-link.stub.ts", import.meta.url));
const PHOTO_STUB = fileURLToPath(new URL("./photo-search.stub.ts", import.meta.url));

function isAuthSession(source: string): boolean {
  return source.endsWith("/lib/auth/session") || source.endsWith("/lib/auth/session.ts");
}

function isGeo(source: string): boolean {
  return source.endsWith("/platform/geo") || source.endsWith("/platform/geo.ts");
}

function storyReplacement(source: string, importer?: string): string | null {
  if (/\/photo-search(?:\.ts)?$/.test(source) && importer !== PHOTO_STUB) return PHOTO_STUB;
  if (source === "@tanstack/react-start" || source === "@tanstack/react-start/server") return START_STUB;
  if (source.endsWith("/lib/auth/neon-auth") && importer?.endsWith("/features/auth/ui/use-magic-link-form.ts")) return MAGIC_LINK_STUB;
  if (isAuthSession(source)) return STUB;
  return isGeo(source) ? GEO_STUB : null;
}

export function storybookAuthBoundary(): Plugin {
  return { name: "storybook-runtime-boundary", enforce: "pre", resolveId: storyReplacement };
}
