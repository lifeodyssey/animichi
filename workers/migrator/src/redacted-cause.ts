/**
 * What a thrown value is allowed to tell the operator (#1868).
 *
 * A bare `catch` that keeps only a stable code is safe and useless: the 2026-09-22 staging
 * failure read `{"success":false,"error":"migration_unavailable"}` while the platform's own
 * message — the Durable Object reset — was sitting in the thrown error. This turns a thrown
 * value into one line CD can print, with every credential removed first.
 *
 * `scripts/delivery/migrate-through-worker.sh` redacts DSN passwords again before it logs the
 * body, so the two are independent. The rule here is the stricter of the pair: the script
 * keeps `://user:***@host/db`, this replaces the whole PostgreSQL URL, because the criterion
 * is "no DSN, credential or connection string" and a host and role together are a connection
 * string. The keyword form (`password=…`) has no URL to swallow, so it keeps its own rule.
 */

/** Long enough for a driver's first sentence; short enough that a stack cannot become the body. */
const CAUSE_LIMIT = 200;

const CREDENTIAL_PATTERNS: readonly [RegExp, string][] = [
  [/(?:postgres|postgresql):\/\/\S+/gi, "postgresql://[redacted]"],
  [/password\s*=\s*[^\s&"']+/gi, "password=[redacted]"],
];

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** One redacted line naming what threw. Never a DSN, a credential or a connection string. */
export function redactedCause(error: unknown): string {
  const redacted = CREDENTIAL_PATTERNS.reduce(
    (message, [pattern, replacement]) => message.replace(pattern, replacement),
    messageOf(error),
  );
  return redacted.slice(0, CAUSE_LIMIT);
}
