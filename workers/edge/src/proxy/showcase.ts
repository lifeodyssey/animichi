/**
 * Showcase-mode gate for the edge worker (S0-v2 GOAL C / C9 card).
 *
 * The web app's `VITE_SHOWCASE_MODE` (see `apps/web/src/features/config/showcase.ts`)
 * makes prod a landing-only demo; this is the worker-side backend denial that
 * makes "pure showcase" hold beyond the UI — a direct curl at /v1/chat,
 * /v1/photo-search, /v1/users/* or the public catalog read answers 403 while
 * the landing's own surface (/healthz, /img/*, /tiles/*) stays reachable.
 *
 * Value contract mirrors C1's strict boolean: only the literal "false" opens
 * the functional backend. "true" arms the gate; unset, empty or malformed
 * values FAIL CLOSED (deny) — a missing var must never silently expose the
 * backend in prod. Unlike the web app (which throws at config-load time when
 * VITE_SHOWCASE_MODE is missing), this worker cannot throw per request — that
 * would 500 the landing surface the showcase is meant to serve — so the
 * fail-closed denial is paired with a one-per-instance warning so a
 * misconfigured value is visible in Worker logs instead of silent (see #441/
 * #443 for this repo's precedent against silent fail-open config handling).
 * The variable is consumed by the edge worker itself and is deliberately NOT
 * in `CONTAINER_ENV_KEYS` (that list is the worker→container forwarding
 * allowlist; the container is unreachable except through this worker, so the
 * edge gate is the complete public ingress control).
 *
 * The warn-once dedupe is INSTANCE state (a fresh gate per app instance), not
 * module state: production creates one app per isolate, so one gate per
 * isolate warns once — while tests create one gate per case and never share
 * state, which is what makes the warn contract testable without ordering
 * assumptions.
 */

export interface ShowcaseMode {
  /** True when the edge must deny functional backend routes. */
  isEnabled(raw: string | undefined): boolean;
}

/** Builds one showcase gate. `warn` is injectable so tests can capture the
 * warning without touching console (the message stays the real one). The
 * factory owns only the per-instance warn-once state; `isEnabled` holds the
 * two responsibilities as two statements — strict-boolean evaluation, then
 * the one-time misconfiguration warning (message formatting lives in
 * `showcaseMisconfigurationMessage`). */
export function createShowcaseMode(warn: (message: string) => void = console.warn): ShowcaseMode {
  let malformedValueWarned = false;
  return {
    isEnabled(raw: string | undefined): boolean {
      if (raw === "true" || raw === "false") return raw === "true";
      if (!malformedValueWarned) { malformedValueWarned = true; warn(showcaseMisconfigurationMessage(raw)); }
      return true;
    },
  };
}

function showcaseMisconfigurationMessage(raw: string | undefined): string {
  return (
    `EDGE_SHOWCASE_MODE=${JSON.stringify(raw)} is neither the literal "true" nor "false" — ` +
    "failing closed (functional routes denied). Fix wrangler.toml."
  );
}
