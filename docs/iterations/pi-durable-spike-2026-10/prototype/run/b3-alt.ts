/**
 * b3-alt, recorded: question 1's eviction (SIGKILL of workerd while the tool's catalog call is held, after the wake
 * job's 30 s heartbeat re-arm is durable) on `q2/b3-alt.worker.ts`, where Pi runs on an `alt_` SQLite store the
 * factory opened, not on the store `PiHarness` prepared. Nothing is sent to the restarted object until it has answered.
 * Writes `../evidence/q2-b3-alt.json`, then exits non-zero if any check failed.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundle } from "./bundle.ts";
import { summarize } from "./q1-scenarios.ts";
import { OutboundGuard, WorkerdLog, startWorkerd, withTimeout, writeEvidence } from "./workerd.ts";

interface Event { readonly seq: number; readonly instance: string; readonly kind: string; readonly detail: unknown; readonly at: number }
interface Report {
  readonly instance: string;
  readonly piHarnessWait: { status: string; reason?: string };
  readonly settledByPiFromAltStore: { status: string; reason?: string } | null;
  readonly rows: { altSubmissions: number; piSubmissions: number; altEntries: number; piEntries: number };
  readonly tables: string[];
  readonly messages: Parameters<typeof summarize>[0];
  readonly events: Event[];
}

const INTERRUPTED = "Tool resolve_anime was interrupted and may have partially run";
const work = mkdtempSync(join(tmpdir(), "pi-durable-spike-b3-alt-"));
const built = await bundle("q2/b3-alt.worker.ts", work);
const log = new WorkerdLog();
const guard = new OutboundGuard();
const DURABLE_OBJECTS = { SAFE: { className: "SafeProbe", useSQLite: true as const }, UNSAFE: { className: "UnsafeProbe", useSQLite: true as const } };
const start = (run: string, persist: string) => startWorkerd(built, { run, persist: join(work, persist), log, guard, durableObjects: DURABLE_OBJECTS });

async function call<T>(mf: ReturnType<typeof start>, path: string, body: unknown): Promise<T> {
  const response = await mf.dispatchFetch(`https://probe.test${path}`, { method: "POST", body: JSON.stringify(body) });
  const text = await response.text();
  if (response.status !== 200) throw new Error(`${path} answered ${String(response.status)}: ${text}`);
  return JSON.parse(text) as T;
}

async function evict(binding: "safe" | "unsafe", title: string) {
  const hold = guard.holdFirstCall(title);
  const operationId = `${binding}-alt-1`;
  const first = start(`${binding}:A`, `persist-${binding}`);
  const receipt = await call(first, `/${binding}/evict/submit`, { title, operationId });
  const inFlightAt = await withTimeout(hold.inFlight, 60_000, `the ${binding} tool's first catalog call`);
  await log.waitFor(`${binding}:A`, /\[spike\] alarm /, 30_000, `the ${binding} wake job's first alarm on A`);
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  const killedAt = Date.now();
  await first.dispose();
  hold.release();
  const second = start(`${binding}:B`, `persist-${binding}`);
  await second.ready;
  const answer = await log.waitFor(`${binding}:B`, /\[spike\] model:answer /, 150_000, `the restarted ${binding} object's answer`);
  const firstRequestAt = Date.now();
  try {
    const report = await call<Report>(second, `/${binding}/evict/report`, { operationId });
    return { binding, operationId, receipt, inFlightAt, killedAt, answerLoggedAt: answer.at, firstRequestAt, catalogCalls: guard.catalogCalls.filter((c) => c.title === title),
      ...report, transcript: summarize(report.messages), messages: undefined };
  } finally {
    await second.dispose();
  }
}

const checks: { readonly name: string; readonly pass: boolean; readonly observed: unknown }[] = [];
const check = (name: string, pass: boolean, observed: unknown) => { checks.push({ name, pass, observed }); };
const runs = [await evict("safe", "Alt Safe"), await evict("unsafe", "Alt Unsafe")];
for (const run of runs) {
  const killed = run.events.find((event) => event.kind === "request:submit")?.instance;
  const after = run.events.filter((event) => event.instance !== killed);
  const firstRequest = after.findIndex((event) => event.kind.startsWith("request:"));
  const before = after.slice(0, firstRequest === -1 ? after.length : firstRequest);
  const answering = before.find((event) => event.kind === "model:answer")?.instance;
  const name = `${run.binding} (alt_ store)`;
  check(`${name}: workerd A was SIGKILLed while the tool's catalog call was held`, run.catalogCalls[0]?.held === true && run.killedAt >= run.inFlightAt, run.catalogCalls);
  check(`${name}: a new instance answered before any request, and the pi-wake job ran on it first`, answering !== undefined && answering !== killed
    && before.some((event) => event.instance === answering && event.kind === "job") && run.firstRequestAt >= run.answerLoggedAt,
  before.map((event) => `${event.instance.slice(0, 8)} ${event.kind}`));
  check(`${name}: the factory reopened the alt store on the answering instance`, before.some((event) => event.instance === answering && event.kind === "factory:opened-alt-store"), null);
  check(`${name}: Pi settled the operation done, read through Pi from the alt store`, run.settledByPiFromAltStore?.status === "done", run.settledByPiFromAltStore);
  check(`${name}: Pi's rows are under alt_, none under PiHarness's pi_ prefix`, run.rows.altSubmissions === 1 && run.rows.piSubmissions === 0
    && run.rows.altEntries > 0 && run.rows.piEntries === 0, { rows: run.rows, tables: run.tables });
  check(`${name}: PiHarness's wait() still answers from its own empty store (unanswered, not_found)`, run.piHarnessWait.status === "unanswered"
    && run.piHarnessWait.reason === "not_found", run.piHarnessWait);
}
const [safe, unsafe] = runs as [typeof runs[0], typeof runs[0]];
const toolResult = (run: typeof safe) => run.transcript.find((step) => step.kind === "pi.tool-result");
check("safe: the tool ran again after the kill (two catalog calls), and its result reached the model", safe.catalogCalls.length === 2
  && toolResult(safe)?.isError === false, { calls: safe.catalogCalls, result: toolResult(safe) });
check("unsafe: the tool did not run again (one catalog call), and the model received the interrupted result", unsafe.catalogCalls.length === 1
  && toolResult(unsafe)?.isError === true && (toolResult(unsafe)?.text ?? "").includes(INTERRUPTED), { calls: unsafe.catalogCalls, result: toolResult(unsafe) });
check("guard: no request other than the stubbed catalog left workerd", guard.violations.length === 0, guard.violations);

const t0 = log.lines[0]?.at ?? 0;
writeEvidence("q2-b3-alt.json", { runtime: built.runtime, runs: runs.map((run) => ({ ...run, timing: { killToAnswerMs: run.answerLoggedAt - run.killedAt } })), checks,
  workerdLog: log.lines.map((line) => `+${String(line.at - t0).padStart(6)}ms ${line.run} ${line.stream}: ${line.text}`) });
for (const item of checks) console.log(`${item.pass ? "PASS" : "FAIL"} ${item.name}`);
process.exitCode = checks.every((item) => item.pass) ? 0 : 1;
