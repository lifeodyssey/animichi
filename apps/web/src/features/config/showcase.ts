const SHOWCASE_MODE_VALUES = ["true", "false"] as const;

export type ShowcaseMode = (typeof SHOWCASE_MODE_VALUES)[number];

const SHOWCASE_MODE_ERROR =
  'VITE_SHOWCASE_MODE must be exactly "true" or "false". Fail-closed: an unset, empty, or malformed value refuses to load the landing.';

function parseShowcaseMode(raw: string | undefined): ShowcaseMode {
  if (raw === "true" || raw === "false") return raw;
  throw new Error(`${SHOWCASE_MODE_ERROR} Received: ${JSON.stringify(raw)}.`);
}

/** Evaluated once at module init (build/SSR) so any misconfiguration crashes loudly. */
const SHOWCASE_MODE = parseShowcaseMode(import.meta.env.VITE_SHOWCASE_MODE);

/** True when the deploy serves the landing-only "under construction" showcase. */
export function isShowcase(): boolean {
  return SHOWCASE_MODE === "true";
}
