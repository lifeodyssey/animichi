import type { HTTPTransactionOptions } from "@neondatabase/serverless";

/**
 * #1958 — a Neon HTTP call in the apply path that stops answering fails by name instead of
 * hanging until CD's own curl gives up.
 *
 * The driver carries `fetchOptions` straight into `fetch` (installed
 * `@neondatabase/serverless@1.1.0`: `index.d.ts:453` declares it, `index.mjs:1292` spreads it
 * into the fetch init), so `signal` is the driver's own mechanism: an aborted call rejects
 * inside the driver rather than leaving the request open.
 *
 * One deadline PER CALL. The apply's own duration is deliberately not bounded here: a staging
 * chain apply took about 3 minutes on 2026-09-24, and a single deadline over it would abort a
 * normal apply.
 *
 * 45 s is chosen between two measured bounds, not picked round. Above: Cloudflare's own 30 s
 * cap on a blocked callback, because a round trip that outlasts that cap is a shape this repo
 * already proves must SUCCEED — `test/integration/prisma.workerd.integration.ts` injects 31 s
 * on the next round trip (#1868), and a 30 s deadline turned that proof red the first time it
 * was run (2026-09-24). Below: the CD preflight's own `--max-time 60`
 * (`.github/scripts/release/schema-preflight.sh`), which leaves the route 15 s to send its
 * named failure back before curl gives up on a 45 s stall. And it is 30x the 1-1.5 s a healthy
 * direct probe of the same endpoint took.
 *
 * The two Prisma calls (`previewPrisma`, `migratePrisma`) are outside this on purpose:
 * `createPostgresControlClient`'s `connect(connection?: unknown)` takes the URL alone, so there
 * is no per-call option to pass a deadline through, and the chain apply is the long, legitimate
 * one. Their entry line (`src/step-log.ts`) is what names a stall, and CD's curl bound ends it.
 */

export const NEON_CALL_DEADLINE_MS = 45_000;

/** A FRESH signal per call: one shared signal would expire on the apply's first calls and
 * abort every call after it, which is the whole-apply deadline this card refuses. */
export function neonDeadline(): Pick<HTTPTransactionOptions<false, false>, "fetchOptions"> {
  return { fetchOptions: { signal: AbortSignal.timeout(NEON_CALL_DEADLINE_MS) } };
}
