/** What every run shares: the outbound guard (way 11), workerd's log, Miniflare over one persisted directory, evidence. */
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import type { Readable } from "node:stream";
import { Log, LogLevel, Miniflare } from "miniflare";
import { PROTOTYPE, REPOSITORY, type Bundle } from "./bundle.ts";

export const EVIDENCE = join(PROTOTYPE, "..", "evidence");

export interface LogLine { readonly run: string; readonly at: number; readonly stream: "stdout" | "stderr"; readonly text: string }

/** workerd's stdout and stderr, line by line, labelled with the process (run) that wrote them. */
export class WorkerdLog {
  readonly lines: LogLine[] = [];
  #waiters: { run: string; pattern: RegExp; resolve: (line: LogLine) => void }[] = [];

  attach(run: string) {
    return (stdout: Readable, stderr: Readable) => { this.#read(run, "stdout", stdout); this.#read(run, "stderr", stderr); };
  }

  #read(run: string, stream: "stdout" | "stderr", source: Readable) {
    createInterface({ input: source }).on("line", (text) => {
      const line = { run, at: Date.now(), stream, text };
      this.lines.push(line);
      const due = this.#waiters.filter((waiter) => waiter.run === run && waiter.pattern.test(text));
      this.#waiters = this.#waiters.filter((waiter) => !due.includes(waiter));
      for (const waiter of due) waiter.resolve(line);
    });
  }

  waitFor(run: string, pattern: RegExp, timeoutMs: number, what: string): Promise<LogLine> {
    const seen = this.lines.find((line) => line.run === run && pattern.test(line.text));
    if (seen) return Promise.resolve(seen);
    return withTimeout(new Promise((resolve) => { this.#waiters.push({ run, pattern, resolve }); }), timeoutMs, what);
  }
}

/** Every wait is bounded, so a hang names what it was waiting for instead of eating the time box. */
export function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${String(ms)} ms waiting for ${what}`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export interface CatalogCall { readonly at: number; readonly title: string; readonly held: boolean }
interface Hold { readonly inFlight: PromiseWithResolvers<number>; readonly release: PromiseWithResolvers<undefined> }

/**
 * Way 11: every request a worker sends leaves through this handler. The stubbed catalog answers; anything else is
 * refused and recorded, and the runner fails on any record, because a fetch refused inside the worker can be caught
 * and swallowed there. It lives in Node, outside workerd, so its counts survive the kill.
 */
export class OutboundGuard {
  readonly violations: { at: number; method: string; url: string }[] = [];
  readonly catalogCalls: CatalogCall[] = [];
  readonly #holds = new Map<string, Hold>();

  /** Hold the first catalog call for `title` until `release()`, so the object can be killed while the tool runs. */
  holdFirstCall(title: string) {
    const hold = { inFlight: Promise.withResolvers<number>(), release: Promise.withResolvers<undefined>() };
    this.#holds.set(title, hold);
    return { inFlight: hold.inFlight.promise, release: () => hold.release.resolve(undefined) };
  }

  readonly handler = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (url.origin !== "https://catalog.internal" || url.pathname !== "/v1/resolve") {
      this.violations.push({ at: Date.now(), method: request.method, url: request.url });
      throw new Error(`spike outbound guard refused ${request.method} ${request.url}`);
    }
    const title = url.searchParams.get("title") ?? "";
    const hold = this.#holds.get(title);
    const held = hold !== undefined && this.calls(title) === 0;
    this.catalogCalls.push({ at: Date.now(), title, held });
    if (!held) return Response.json({ outcome: "resolved", match: { bangumi_id: "1556", title, title_cn: "巡礼" } });
    hold.inFlight.resolve(Date.now());
    await hold.release.promise;
    return new Response("released after the kill", { status: 503 });
  };

  calls(title: string) { return this.catalogCalls.filter((call) => call.title === title).length; }
}

export interface Start {
  readonly run: string;
  readonly persist: string;
  readonly log: WorkerdLog;
  readonly guard: OutboundGuard;
  readonly durableObjects: Record<string, { readonly className: string; readonly useSQLite: true }>;
}

/** One workerd process over the persisted directory; `dispose()` is Miniflare's SIGKILL of that process. */
export function startWorkerd(built: Bundle, start: Start): Miniflare {
  return new Miniflare({
    modulesRoot: dirname(built.path),
    modules: [{ type: "ESModule", path: built.path }],
    compatibilityDate: built.runtime.compatibilityDate,
    compatibilityFlags: built.runtime.compatibilityFlags,
    durableObjects: start.durableObjects,
    durableObjectsPersist: start.persist,
    outboundService: start.guard.handler,
    handleRuntimeStdio: start.log.attach(start.run),
    cf: false,
    log: new Log(LogLevel.WARN),
  });
}

/** Saved evidence carries no machine paths; the repository is public. */
export function sanitize(text: string): string {
  const roots: [string, string][] = [[REPOSITORY.replace(/\/$/, ""), "<repo>"], [realpathSync(tmpdir()), "<tmp>"], [tmpdir(), "<tmp>"],
    [homedir(), "<home>"]];
  return roots.reduce((value, [root, label]) => value.split(root).join(label), text);
}

export function writeEvidence(name: string, value: unknown): string {
  mkdirSync(EVIDENCE, { recursive: true });
  const path = join(EVIDENCE, name);
  writeFileSync(path, `${sanitize(typeof value === "string" ? value : JSON.stringify(value, null, 2))}\n`);
  return path;
}
