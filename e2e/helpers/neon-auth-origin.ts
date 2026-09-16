/**
 * The Neon Auth origin this suite targets, resolved once (#1690 review).
 *
 * `playwright.config.ts` needs this value to point the app under test at a Neon
 * Auth branch, and `web-neon-login.spec.ts` needs the same value to post the
 * live sign-in to it. Both sites used to carry a resolution rule of their own,
 * and the two rules disagree exactly when the primary variable is declared but
 * EMPTY: the config took the first non-empty value after trimming — skipping
 * the empty one for the `VITE_` value — while the spec's `??` fallback took the
 * empty string. The app under test then targeted one origin while the proof
 * refused to look at it, failing before login for a reason that had nothing to
 * do with login.
 *
 * So the rule — and the names it reads — live here, once, and both sites read
 * them. A second copy of either is how the two drifted apart.
 */
export const NEON_AUTH_ORIGIN_ENV_VARS = ["NEON_AUTH_BASE_URL", "VITE_NEON_AUTH_BASE_URL"] as const;

/** The environment shape both callers have (`process.env`), narrowed to what
 *  the rule reads so the rule is testable without touching the process. */
export type DeclaredOrigins = Readonly<Record<string, string | undefined>>;

/**
 * The first name in {@link NEON_AUTH_ORIGIN_ENV_VARS} that is set to something,
 * trimmed; `undefined` when none is.
 *
 * Empty and whitespace-only values are not declarations: the app cannot be
 * pointed at `""`, and a caller must not treat one as an origin just because
 * the variable exists. The type-aware lint forbids a bare `||` on a
 * possibly-undefined value, so the fall-through is spelled out.
 */
export function declaredNeonAuthOrigin(env: DeclaredOrigins): string | undefined {
  const declared = NEON_AUTH_ORIGIN_ENV_VARS.map((name) => env[name]?.trim());
  return declared.find((value) => value !== undefined && value !== "");
}
