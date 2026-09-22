/**
 * The operator's surface for the ceiling's store failures (#1833) — the other
 * half of what `upstream-ceiling.ts` decides.
 *
 * WHY IT IS NOT THE CALLER'S SURFACE. The caller reads three ceiling outcomes
 * and classifies by `x-egress-refusal`, which `workers/catalog` knows and reads
 * an unknown member of as `unmarked`; a fourth outcome there would be a lie
 * about whose answer it is. An operator reads a log stream, where the opposite
 * is true: the more the line says, the better, and there is no vocabulary to
 * keep stable. This module is that second surface and it shares no type with
 * the first.
 *
 * WHY STDERR AND NOT LOGFIRE. `docs/ops/anitabi-egress.md` is this service's
 * operating document, and every diagnostic step in it ends at `fly logs` — the
 * service runs on Fly, outside the CD and observability lanes the Workers are
 * instrumented by, with no runtime dependencies beyond Node and no Logfire
 * token in its environment. A client library here would be a new dependency, a
 * new secret and a new failure mode in the one service whose design is "nothing
 * but a counter", for a line the platform already carries. So the line goes to
 * the process's own stderr, which is what `fly logs` reads.
 *
 * THE LINE IS BUILT FROM THE FAILURE AND NOTHING ELSE. It carries the code and
 * the store's own message — the two fields of `CeilingStoreFailure` — and no
 * address, no command and no credential, because nothing here has one to carry.
 * The store's Private URL holds a password, so a line that interpolated it
 * would leak the credential it was added to debug; that is a property this
 * module keeps by having no other input, and one its test drives every failure
 * path to check.
 */
import type { CeilingStoreFailure, CeilingStoreFailureReporter } from "./upstream-ceiling.ts";

/**
 * Where one line goes: the process's stderr in the service, a list a test owns
 * in a test. Injecting it is what lets the line be asserted on rather than
 * merely believed.
 */
export type LogSink = (line: string) => void;

/**
 * The reporter a ceiling is constructed with: one JSON line per store failure,
 * written to `sink`. One line per failure rather than a sentence among others,
 * so an operator can filter the stream by `event` and group by `code` without
 * reading prose. Fly stamps each line with its own time, so the line carries
 * none: a clock here would be a second one, and a test would have to unpick it.
 */
export function ceilingStoreFailureLogger(sink: LogSink): CeilingStoreFailureReporter {
  return (failure: CeilingStoreFailure) => {
    sink(`${JSON.stringify({ event: "ceiling-store-failure", code: failure.code, message: failure.message })}\n`);
  };
}
