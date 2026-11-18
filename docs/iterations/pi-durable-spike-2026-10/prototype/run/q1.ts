/**
 * Question 1, recorded. In workerd at the edge's compatibility settings: one plain turn, a validation probe, an
 * eviction (SIGKILL of workerd) during the tool call with `replay: "safe"` and again with `replay: "unsafe"`, and the
 * outbound guard's negative control. Writes every observation under `../evidence/`, then exits non-zero if any check
 * failed, so the evidence exists for a failing run too.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundle } from "./bundle.ts";
import { Scenarios, type Event, type Step } from "./q1-scenarios.ts";
import { writeEvidence } from "./workerd.ts";

const INTERRUPTED = "Tool resolve_anime was interrupted and may have partially run";
const work = mkdtempSync(join(tmpdir(), "pi-durable-spike-q1-"));
const built = await bundle("src/q1.worker.ts", work);
const scenarios = new Scenarios(built, work);
const checks: { readonly name: string; readonly pass: boolean; readonly observed: unknown }[] = [];
const check = (name: string, pass: boolean, observed: unknown) => { checks.push({ name, pass, observed }); };

const calls = (steps: Step[]) => steps.flatMap((step) => step.toolCalls ?? []);
const results = (steps: Step[]) => steps.filter((step) => step.kind === "pi.tool-result");
const answer = (steps: Step[]) => steps.filter((step) => step.kind === "pi.assistant" && step.text !== undefined).at(-1)?.text ?? "";
const status = (result: unknown) => (result as { status?: string }).status;

/**
 * What the instances after the kill did, in order, up to the first request. workerd may build an instance for the
 * alarm invocation the kill interrupted and cancel that delivery (its stderr says so); such an instance does nothing.
 */
function restarted(events: Event[]) {
  const killed = events.find((event) => event.kind === "request:submit")?.instance;
  const own = events.filter((event) => event.instance !== killed);
  const firstRequest = own.findIndex((event) => event.kind.startsWith("request:"));
  const beforeEvents = own.slice(0, firstRequest === -1 ? own.length : firstRequest);
  const answered = beforeEvents.find((event) => event.kind === "model:answer");
  const before = beforeEvents.filter((event) => event.instance === answered?.instance).map((event) => event.kind);
  return { killed, instances: [...new Set(own.map((event) => event.instance))], kinds: own.map((event) => `${event.instance.slice(0, 8)} ${event.kind}`),
    answeredBeforeAnyRequest: answered !== undefined, before, constructedAt: own.find((event) => event.instance === answered?.instance)?.at,
    answer: own.find((event) => event.kind === "model:answer")?.detail as { sawToolResult?: { isError: boolean; text: string } } | undefined };
}

const turn = await scenarios.plainTurn("turn", "Turn Probe");
check("turn: the operation settles done", status(turn.result) === "done", turn.result);
check("turn: user, system, one resolve_anime call, its successful result, the answer",
  JSON.stringify(turn.transcript.map((step) => step.kind)) === JSON.stringify(["pi.user", "pi.system", "pi.assistant", "pi.tool-result", "pi.assistant"])
    && calls(turn.transcript).length === 1 && results(turn.transcript)[0]?.isError === false && answer(turn.transcript).startsWith("Resolved:"), turn.transcript);
check("turn: the stubbed catalog counted one call", turn.catalogCalls === 1, turn.catalogCalls);
const anyCalls = turn.probes as { abortSignalAnyCallsSinceLoad: { calls: number; patched: boolean }; abortSignalAnyCallsAfterOwnCall: { calls: number } };
check("probe: the AbortSignal.any counter is live (the probe's own call moves it by exactly one)",
  anyCalls.abortSignalAnyCallsSinceLoad.patched && anyCalls.abortSignalAnyCallsAfterOwnCall.calls === anyCalls.abortSignalAnyCallsSinceLoad.calls + 1,
  { sinceLoad: anyCalls.abortSignalAnyCallsSinceLoad, afterOwnCall: anyCalls.abortSignalAnyCallsAfterOwnCall });

const validation = await scenarios.plainTurn("validation", "Validation Probe");
check("validation: pi-schema refused {} (no title) in a request context, before execute ran",
  results(validation.transcript)[0]?.isError === true && !validation.events.some((event) => event.kind === "tool:start"), results(validation.transcript)[0]);
const coercion = await scenarios.plainTurn("coercion", "Coercion Probe");
check("coercion: pi-schema coerced { title: 42 } to \"42\" and execute ran with it",
  results(coercion.transcript)[0]?.isError === false && scenarios.guard.calls("42") === 1, { result: results(coercion.transcript)[0], callsFor42: scenarios.guard.calls("42") });

const safe = await scenarios.evictDuringToolCall("safe", "Evict Safe");
const unsafe = await scenarios.evictDuringToolCall("unsafe", "Evict Unsafe");
for (const run of [safe, unsafe]) {
  const after = restarted(run.events);
  const name = run.binding;
  check(`${name}: workerd A was SIGKILLed while the tool's catalog call was held in flight`, run.catalogCalls[0]?.held === true && run.killedAt >= run.inFlightAt,
    { inFlightAt: run.inFlightAt, killedAt: run.killedAt, firstCall: run.catalogCalls[0] });
  check(`${name}: a new instance in workerd B answered before any request reached the object`,
    after.answeredBeforeAnyRequest && !after.instances.includes(after.killed ?? "") && run.firstRequestAt >= run.answerLoggedAt,
    { instances: after.instances, kinds: after.kinds, answerLoggedAt: run.answerLoggedAt, firstRequestAt: run.firstRequestAt });
  check(`${name}: the lifecycle job (pi-wake) ran on the answering instance before any request`, after.before.includes("job"), after.before);
  check(`${name}: the operation settled done`, status(run.result) === "done", run.result);
  check(`${name}: one tool call in the transcript, one tool result, then the answer`, calls(run.transcript).length === 1 && results(run.transcript).length === 1,
    run.transcript);
}
check("safe: the tool ran again after the eviction (two catalog calls, the second answered)",
  safe.catalogCalls.length === 2 && safe.catalogCalls[1]?.held === false && restarted(safe.events).before.includes("tool:start"), safe.catalogCalls);
check("safe: the rerun's successful result reached the model, and the answer uses it", results(safe.transcript)[0]?.isError === false
  && restarted(safe.events).answer?.sawToolResult?.isError === false && answer(safe.transcript).startsWith("Resolved:"), restarted(safe.events).answer);
check("unsafe: the tool did not run again (one catalog call, no tool:start on the restarted instance)",
  unsafe.catalogCalls.length === 1 && !restarted(unsafe.events).kinds.some((kind) => kind.endsWith(" tool:start")), unsafe.catalogCalls);
check("unsafe: the model received the interrupted result and answered from it",
  results(unsafe.transcript)[0]?.isError === true && results(unsafe.transcript)[0]?.text?.includes(INTERRUPTED) === true
    && restarted(unsafe.events).answer?.sawToolResult?.isError === true && restarted(unsafe.events).answer?.sawToolResult?.text.includes(INTERRUPTED) === true
    && answer(unsafe.transcript).startsWith("Lookup failed:"), { stored: results(unsafe.transcript)[0], modelSaw: restarted(unsafe.events).answer });
check("PiHarness logged no missing-onWake warning", !scenarios.log.lines.some((line) => line.text.includes("did not pass onWake")), null);

const guard = await scenarios.guardSelfTest();
const refusal = guard.response as { refused?: boolean; status?: number };
check("guard: the only refused request in the whole run is the negative control's, and the worker got no answer from it",
  (refusal.refused === true || (refusal.status ?? 0) >= 500)
    && JSON.stringify(guard.violations.map((violation) => violation.url)) === JSON.stringify(["https://upstream.invalid/spike-guard-self-test"]), guard);

const timing = (run: typeof safe) => ({ killToRestartedInstanceMs: (restarted(run.events).constructedAt ?? 0) - run.killedAt,
  killToAnswerMs: run.answerLoggedAt - run.killedAt, workerdBStartMs: run.restartedAt - run.killedAt });
const t0 = scenarios.log.lines[0]?.at ?? 0;
writeEvidence("q1-turn.json", { runtime: built.runtime, ...turn });
writeEvidence("q1-validation.json", { validation, coercion });
writeEvidence("q1-evict-safe.json", { ...safe, timing: timing(safe) });
writeEvidence("q1-evict-unsafe.json", { ...unsafe, timing: timing(unsafe) });
writeEvidence("q1-guard.json", guard);
writeEvidence("q1-workerd-log.txt",scenarios.log.lines.map((line) => `+${String(line.at - t0).padStart(6)}ms ${line.run} ${line.stream}: ${line.text}`).join("\n"));
writeEvidence("q1-checks.json", { runtime: built.runtime, timing: { safe: timing(safe), unsafe: timing(unsafe) }, checks });
for (const item of checks) console.log(`${item.pass ? "PASS" : "FAIL"} ${item.name}`);
console.log(JSON.stringify({ timing: { safe: timing(safe), unsafe: timing(unsafe) }, probes: turn.probes }));
process.exitCode = checks.every((item) => item.pass) ? 0 : 1;
