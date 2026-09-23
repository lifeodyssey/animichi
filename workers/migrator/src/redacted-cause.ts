/**
 * What a thrown value is allowed to tell the operator (#1868).
 *
 * A bare `catch` that keeps only a stable code is safe and useless: the 2026-09-22 staging
 * failure read `{"success":false,"error":"migration_unavailable"}` while the platform's own
 * message — the Durable Object reset — was sitting in the thrown error. This turns a thrown
 * value into one line CD can print, with the credential shapes below removed first.
 *
 * Those shapes are an inventory, not a guarantee. `SCHEME_DSN`, `KEYWORD_PASSWORD` and
 * `SCHEMELESS_USERINFO` each name the surface they match; a secret written in a shape none of
 * them names survives this function. Widen the inventory when one gets past, and do not read a
 * redacted cause as proof that a message is clean.
 *
 * `scripts/delivery/migrate-through-worker.sh` redacts the body again before it logs, and the
 * two passes are independent rather than one being a fallback for the other. The difference
 * worth knowing: the script keeps `://user:***@host/db`, this removes the user and the host
 * too, because a role and an endpoint together are already a connection string.
 */

/** Long enough for a driver's first sentence; short enough that a stack cannot become the body. */
const CAUSE_LIMIT = 200;

/** A PostgreSQL URL in full, its `?password=` parameter included by swallowing the whole URL. */
const SCHEME_DSN = /(?:postgres|postgresql):\/\/\S+/gi;

/**
 * One `password` key bound to one value, across the five surfaces that carry it: `password=x`,
 * `password: x`, `password='x'`, `password="x"` and `"password":"x"`. The alternation on the
 * value carries all of that variation, so key and separator stay a single capture written back
 * unchanged — which is how `PGPASSWORD=…` keeps its prefix under the case-insensitive match.
 *
 * The unquoted branch lists what ENDS a value, not what a value may contain; the reverse of
 * that is what let `password='…'` through, its leading quote matching nothing at all.
 */
const KEYWORD_PASSWORD = /("?password"?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;&}"']+)/gi;

/**
 * `user:secret@host.tld/db` with the scheme already gone — the userinfo half of a DSN, which a
 * driver prints on its own. Three gates together keep it off ordinary prose: no whitespace
 * anywhere in the pair, a dot required inside the host, and a left boundary so a match cannot
 * begin mid-token. A colon and an at-sign alone are not enough; `12:30 at ops@animichi.com`
 * has both, and fails all three.
 *
 * The secret class is `\S+`, which admits the very at-sign this rule is hunting — on purpose.
 * The trailing `@[\w.-]+\.[\w.-]+` makes the engine give characters back until an at-sign is
 * left standing before a dotted host, so the match lands on the LAST one; that is the split
 * `new URL` performs, and it is why `migrator:secret@x@ep-x.neon.tech/db` is a working
 * credential rather than a malformed string. Narrow the class back to `[^\s@]+` and the rule
 * does not tighten, it stops firing: one at-sign in a password, and the role, the secret and
 * the endpoint all reach the log intact (measured 2026-09-23).
 *
 * The cost is paid in the other direction, and it was already being paid. A token whose secret
 * position opens with an at-sign — a scoped package spec, `npm:@animichi/contract@1.2.3` — is
 * redacted now as well, joining `mailto:ops@example.com`, which was redacted before this. What
 * still keeps prose out is the whitespace gate, which no ordinary sentence gets past.
 */
const SCHEMELESS_USERINFO = /(?<![\w:/@])[\w.-]+:\S+@[\w.-]+\.[\w.-]+(?:[:/]\S*)?/g;

const CREDENTIAL_PATTERNS: readonly [RegExp, string][] = [
  [SCHEME_DSN, "postgresql://[redacted]"],
  [KEYWORD_PASSWORD, "$1[redacted]"],
  [SCHEMELESS_USERINFO, "[redacted]"],
];

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * One redacted line naming what threw: the shapes above replaced, everything else kept. Every
 * pattern runs over the whole message before the cut, so a credential cannot survive by
 * sitting past `CAUSE_LIMIT` — truncation shortens a cause, it never redacts one.
 */
export function redactedCause(error: unknown): string {
  const redacted = CREDENTIAL_PATTERNS.reduce(
    (message, [pattern, replacement]) => message.replace(pattern, replacement),
    messageOf(error),
  );
  return redacted.slice(0, CAUSE_LIMIT);
}
