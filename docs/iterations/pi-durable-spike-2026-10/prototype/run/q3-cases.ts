/**
 * Question 3's workerd cases, driven from Node. Each starts workerd (Miniflare) at the edge's settings with the outbound
 * guard every run installs, runs its script against `q3/q3.worker.ts`, and returns what it observed and its checks;
 * `q3.ts` writes the evidence. Evictions are real SIGKILLs of workerd (Miniflare's `dispose()`), as in question 1.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Miniflare } from "miniflare";
import { BUDGET_ANSWER, LONG_ANSWER, STORED_TEXT, STREAM_ANSWER } from "../q3/q3-cases.ts";
import { bundle, type Bundle } from "./bundle.ts";
import { OutboundGuard, WorkerdLog, startWorkerd, withTimeout } from "./workerd.ts";

export interface CheckItem { readonly name: string; readonly pass: boolean; readonly observed: unknown }

export class Check {
  readonly items: CheckItem[] = [];

  add(name: string, pass: boolean, observed: unknown) {
    this.items.push({ name, pass, observed });
  }
}

const sql = (className: string) => ({ className, useSQLite: true as const });
const DURABLE_OBJECTS = { ADMISSION: sql("AdmissionProbe"), BUDGET: sql("BudgetProbe"), STREAM: sql("StreamProbe"), WEB: sql("WebProbe"),
  REPLAY: sql("ReplayProbe"), RESTART_NO_RETRY: sql("RestartNoRetryProbe"), RESTART_RETRY: sql("RestartRetryProbe"), RESTART_LIMIT: sql("RestartLimitProbe") };

interface Event { readonly seq: number; readonly instance: string; readonly kind: string; readonly detail: Record<string, unknown> | null; readonly at: number }
interface Part { readonly type: string; readonly text?: string; readonly name?: string; readonly arguments?: unknown }
interface Entry { readonly id: number; readonly kind: string; readonly model?: { role: string; content?: string | Part[]; toolName?: string; isError?: boolean;
  stopReason?: string; errorMessage?: string; usage?: unknown }[] }
interface Result { readonly status: string; readonly reason?: string; readonly text?: string }
interface Report { readonly instance: string; readonly result: Result | null; readonly messages: Entry[]; readonly usage: { models?: Record<string, unknown>; tools?: Record<string, unknown> };
  readonly live: Record<string, unknown> | null; readonly fauxCalls: number; readonly events: Event[]; readonly extra?: { reservations?: unknown[] } }

/** Pi's entries, reduced to what the checks read. */
function steps(messages: Entry[]) {
  return messages.map((entry) => {
    const message = entry.model?.[0];
    const content = message?.content;
    const parts = typeof content === "string" ? [{ type: "text", text: content }] : content ?? [];
    return { id: entry.id, kind: entry.kind, role: message?.role ?? null, text: parts.map((part) => (part.type === "text" ? part.text ?? "" : "")).join(""),
      toolCalls: parts.filter((part) => part.type === "toolCall").map((part) => ({ name: part.name, arguments: part.arguments })),
      toolName: message?.toolName, isError: message?.isError, stopReason: message?.stopReason, errorMessage: message?.errorMessage, usage: message?.usage };
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
const kinds = (events: Event[], kind: string) => events.filter((event) => event.kind === kind);

class Q3 {
  readonly log = new WorkerdLog();
  readonly guard = new OutboundGuard();
  readonly #built: Bundle;
  readonly #work: string;

  constructor(built: Bundle, work: string) {
    this.#built = built;
    this.#work = work;
  }

  start(run: string, persist: string): Miniflare {
    return startWorkerd(this.#built, { run, persist: join(this.#work, persist), log: this.log, guard: this.guard, durableObjects: DURABLE_OBJECTS });
  }

  async call<T>(mf: Miniflare, path: string, body: unknown = {}): Promise<T> {
    const response = await mf.dispatchFetch(`https://probe.test${path}`, { method: "POST", body: JSON.stringify(body) });
    const text = await response.text();
    if (response.status !== 200) throw new Error(`${path} answered ${String(response.status)}: ${text}`);
    return JSON.parse(text) as T;
  }

  async once<T>(binding: string, script: (mf: Miniflare) => Promise<T>): Promise<T> {
    const mf = this.start(binding, `persist-${binding}`);
    try {
      return await script(mf);
    } finally {
      await mf.dispose();
    }
  }
}

// ── admission ─────────────────────────────────────────────────────────────────────────────────────────────────────

async function admission(q: Q3) {
  const at = (action: string) => `/admission/a/${action}`;
  const o = await q.once("admission", async (mf) => {
    const rawFirst = await q.call<{ accepted: boolean }>(mf, at("submit"), { text: "A", operationId: "op-raw" });
    const rawSecond = await q.call<{ accepted: boolean }>(mf, at("submit"), { text: "B", operationId: "op-raw" });
    const rawResult = (await q.call<Report>(mf, at("report"), { operationId: "op-raw" })).result;
    const writeSameId = await q.call<{ rejected: boolean; error?: string }>(mf, at("write-same-id"), { operationId: "op-raw" });
    const covered: { status: number; kind: string; receipt?: { accepted: boolean } }[] = [];
    for (const text of ["C", "D", "C"]) covered.push(await q.call(mf, at("admit"), { operationId: "op-covered", text }));
    const report = await q.call<Report>(mf, at("report"), { operationId: "op-covered" });
    return { raw: { rawFirst, rawSecond, rawResult, writeSameId }, covered, coveredResult: report.result, transcript: steps(report.messages), fauxCalls: report.fauxCalls };
  });
  const check = new Check();
  const userTexts = o.transcript.filter((step) => step.kind === "pi.user").map((step) => step.text);
  check.add("PiHarness: a second submit under the same operationId with other content gets accepted: false, and Pi answers only the first",
    o.raw.rawFirst.accepted && !o.raw.rawSecond.accepted && o.raw.rawResult?.text === "Answer to: A", o.raw);
  check.add("pi-durable: a submission of another type (a write) under that request id is rejected",
    o.raw.writeSameId.rejected && (o.raw.writeSameId.error ?? "").includes("already identifies a submission of type input"), o.raw.writeSameId);
  check.add("covering layer: the same id with other content answers 409; the same id with the same content is the existing admission",
    o.covered[0]?.status === 202 && o.covered[1]?.status === 409 && o.covered[2]?.status === 200 && o.covered[2]?.receipt?.accepted === false
      && o.coveredResult?.text === "Answer to: C", { covered: o.covered, result: o.coveredResult });
  check.add("Pi placed A and C only, and the faux model ran twice: B and D never reached the model", JSON.stringify(userTexts) === JSON.stringify(["A", "C"])
    && o.fauxCalls === 2, { userTexts, fauxCalls: o.fauxCalls });
  return { evidence: { ...o, provider: "faux" }, checks: check.items };
}

// ── budget ────────────────────────────────────────────────────────────────────────────────────────────────────────

async function budget(q: Q3) {
  const o = await q.once("budget", async (mf) => {
    const armed = await q.call<{ submittedAt: number; deadlineAt: number; start: { kind: string; timestamp: number; status: string } }>(mf,
      "/budget/b/submit-with-budget", { operationId: "op-budget", text: "Answer at length, please.", budgetMs: 2_000 });
    const settled = await q.call<Report>(mf, "/budget/b/report", { operationId: "op-budget" });
    await sleep(500);
    const report = await q.call<Report>(mf, "/budget/b/report", { operationId: "op-budget" });
    return { armed, result: settled.result, fired: kinds(report.events, "budget:fired")[0]?.detail ?? null,
      abort: kinds(report.events, "budget:abort")[0]?.detail ?? null, live: report.live, transcript: steps(report.messages), usage: report.usage };
  });
  const check = new Check();
  const fired = o.fired as { lateByMs?: number; liveRunFields?: string[]; runTask?: { startedAt: number | null } } | null;
  const abort = { ...fired, aborted: (o.abort as { aborted?: boolean } | null)?.aborted };
  const answer = o.transcript.filter((step) => step.kind === "pi.assistant").at(-1);
  const runFailure = (o.live as { runFailure?: { reason?: string } } | null)?.runFailure;
  check.add("the operation ended unanswered with reason aborted", o.result?.status === "unanswered" && o.result.reason === "aborted", o.result);
  check.add("the host's timer fired within 250 ms after start + budget, and abort(operationId) returned true",
    abort?.aborted === true && (abort.lateByMs ?? -1) >= 0 && (abort.lateByMs ?? 999) < 250, abort);
  check.add("the abort landed mid-answer: the stored answer is aborted and partial", answer?.stopReason === "aborted" && answer.text.length > 0
    && answer.text.length < BUDGET_ANSWER.length, { stopReason: answer?.stopReason, chars: answer?.text.length, of: BUDGET_ANSWER.length });
  check.add("the start read from Pi is the placed pi.user entry's timestamp, stamped within 1 s of the submit",
    o.armed.start.kind === "pi.user" && o.armed.start.timestamp >= o.armed.submittedAt && o.armed.start.timestamp - o.armed.submittedAt < 1_000, o.armed);
  check.add("pi.live.run carries no time field (its fields at the abort)", (abort?.liveRunFields ?? ["?"]).every((field) =>
    ["taskId", "inputs", "turns", "first", "afterRun"].includes(field)), abort?.liveRunFields);
  check.add("after the run, pi.live.runFailure names the abort", runFailure?.reason === "aborted", runFailure);
  return { evidence: { ...o, provider: "faux, tokensPerSecond 40: the aborted frame is faux's own (pi-ai@1.5.2 dist/providers/faux.js:277-281)" }, checks: check.items };
}

// ── stream ────────────────────────────────────────────────────────────────────────────────────────────────────────

interface WatchSummary { readonly entries: number; readonly before: number | null; readonly running: boolean; readonly partialChars: number;
  readonly answerEntries: number[]; readonly ops?: number; readonly opPreview?: string }

async function stream(q: Q3) {
  const o = await q.once("stream", (mf) => q.call<{ result: Result; operationEntries: { placed: number | null; answer: number | null }; earlyFirst: WatchSummary;
    earlyCalls: WatchSummary[]; earlyCallsBeforeLate: number; lateFirst: WatchSummary; lateCalls: WatchSummary[]; compaction: unknown }>(mf, "/stream/s/scenario",
  { operationId: "op-stream" }));
  const check = new Check();
  const partials = o.earlyCalls.slice(0, o.earlyCallsBeforeLate).map((call) => call.partialChars).filter((chars) => chars > 0);
  const lastEarly = o.earlyCalls.at(-1);
  const lastLate = o.lateCalls.at(-1);
  const endIndex = o.earlyCalls.findIndex((call, index) => index > 0 && !call.running && (o.earlyCalls[index - 1]?.running ?? false));
  const endCall = o.earlyCalls[endIndex];
  check.add("the operation answered", o.result.status === "done" && o.result.text === STREAM_ANSWER, o.result);
  check.add("the first value is a window of the newest 50 of the 60 seeded entries, with `before` set", o.earlyFirst.entries === 50 && o.earlyFirst.before !== null,
    o.earlyFirst);
  check.add("before the late attach, the first watcher had received at least three changes carrying a growing partial",
    partials.length >= 3 && partials.every((chars, index) => index === 0 || chars >= (partials[index - 1] ?? 0)), { partials });
  check.add("the late watcher's first value already holds the partial so far, as state, and it receives fewer changes than the first watcher",
    o.lateFirst.partialChars > 0 && o.lateFirst.running && o.lateCalls.length < o.earlyCalls.length,
    { lateFirst: o.lateFirst, lateCalls: o.lateCalls.length, earlyCalls: o.earlyCalls.length });
  check.add("both watchers end on the same view: the answer entry, no run, no partial", lastEarly !== undefined && lastLate !== undefined
    && JSON.stringify(lastEarly.answerEntries) === JSON.stringify(lastLate.answerEntries) && !lastEarly.running && !lastLate.running
    && lastEarly.partialChars === 0 && lastLate.partialChars === 0, { lastEarly, lastLate });
  check.add("the operation's end shows as pi.live.run leaving the view; no other end marker exists in the watch",
    endCall !== undefined, { endCall, answerEntry: o.operationEntries.answer });
  return { evidence: { ...o, endOfRun: { callIndex: endIndex, call: endCall, answerArrivesInThatCall: endCall?.answerEntries.includes(o.operationEntries.answer ?? -1) ?? false },
    provider: "faux, tokensPerSecond 50" }, checks: check.items };
}

// ── web results ───────────────────────────────────────────────────────────────────────────────────────────────────

async function webResults(q: Q3) {
  const at = (action: string) => `/web/w/${action}`;
  const o = await q.once("web", async (mf) => {
    const results: Record<string, Result | null> = {};
    for (const [operationId, text] of [["op-w1", "search"], ["op-w2", "again"]] as const) {
      await q.call(mf, at("submit"), { text, operationId });
      results[operationId] = (await q.call<Report>(mf, at("report"), { operationId })).result;
    }
    await q.call(mf, at("flags"), { renderThrows: true });
    await q.call(mf, at("submit"), { text: "third", operationId: "op-w3" });
    const report = await q.call<Report>(mf, at("report"), { operationId: "op-w3" });
    results["op-w3"] = report.result;
    return { results, requests: kinds(report.events, "model:request").map((event) => event.detail), hooks: kinds(report.events, "hook:web-render").map((event) => event.detail),
      reports: kinds(report.events, "report").map((event) => event.detail), statusHooks: kinds(report.events, "hook:status").length, fauxCalls: report.fauxCalls,
      transcript: steps(report.messages) };
  });
  const check = new Check();
  const requests = o.requests as { user: string; lastRole: string; webResultsSeen: string[] }[];
  const afterTool = requests.find((request) => request.user === "search" && request.lastRole === "toolResult");
  const again = requests.filter((request) => request.user === "again");
  const third = requests.filter((request) => request.user === "third");
  const reports = o.reports as { kind: string; extension?: string }[];
  const reportsFor = (extension: string) => reports.filter((report) => report.kind === "extension_error" && report.extension === extension).length;
  const stored = o.transcript.filter((step) => step.kind === "pi.tool-result" && step.toolName === "web_search").map((step) => step.text);
  check.add("turn 1: after the tool ran, the model received the rebuilt text, not the stored text, although the status hook threw before it",
    JSON.stringify(afterTool?.webResultsSeen) === JSON.stringify(["RENDERED Hyouka"]), afterTool);
  check.add("turn 2: a later request rebuilds the earlier turn's result again, on the failed attempt (503) and on its retry",
    again.length === 2 && again.every((request) => JSON.stringify(request.webResultsSeen) === JSON.stringify(["RENDERED Hyouka"])) && o.results["op-w2"]?.status === "done",
    { again, result: o.results["op-w2"] });
  check.add("the rebuild ran once per model request attempt (hook calls = faux calls = status hook calls)", o.hooks.length === o.fauxCalls && o.statusHooks === o.fauxCalls,
    { hooks: o.hooks.length, fauxCalls: o.fauxCalls, statusHooks: o.statusHooks });
  check.add("the hook read `details` from the stored message itself", (o.hooks as { detailsPresent: boolean[] }[]).every((hook) => hook.detailsPresent.every(Boolean)),
    o.hooks);
  check.add("the status hook's throw was reported (extension_error) and skipped on every request", reportsFor("status") === o.fauxCalls,
    { statusReports: reportsFor("status"), fauxCalls: o.fauxCalls });
  check.add("turn 3: with the rebuild throwing, the model received the stored text, and the throw was reported",
    third.length === 1 && JSON.stringify(third[0]?.webResultsSeen) === JSON.stringify([STORED_TEXT]) && reportsFor("web-render") === 1, { third, renderReports: reportsFor("web-render") });
  check.add("the transcript keeps the stored text: the rebuild changes the request, not the record", JSON.stringify(stored) === JSON.stringify([STORED_TEXT]), stored);
  return { evidence: { ...o, provider: "faux; its retryable error frame is a scripted 503 message (pi-ai@1.5.2 dist/utils/retry.js:29-43)" }, checks: check.items };
}

// ── evictions: replay and restart ─────────────────────────────────────────────────────────────────────────────────

interface Eviction { readonly binding: string; readonly operationId: string; readonly text: string; readonly hold?: string;
  readonly killWhen: (run: string) => Promise<void>; readonly doneOnB: RegExp }

/** Submit on workerd A, wait for the kill point, SIGKILL A, start B over the same directory, and send nothing until `doneOnB`. */
async function evict(q: Q3, e: Eviction) {
  const hold = e.hold === undefined ? undefined : q.guard.holdFirstCall(e.hold);
  const first = q.start(`${e.binding}:A`, `persist-${e.binding}`);
  const receipt = await q.call(first, `/${e.binding}/evict/submit`, { text: e.text, operationId: e.operationId });
  const inFlightAt = hold === undefined ? null : await withTimeout(hold.inFlight, 60_000, `${e.binding}'s held catalog call`);
  await e.killWhen(`${e.binding}:A`);
  const killedAt = Date.now();
  await first.dispose();
  hold?.release();
  const second = q.start(`${e.binding}:B`, `persist-${e.binding}`);
  await second.ready;
  const restartedAt = Date.now();
  const done = await q.log.waitFor(`${e.binding}:B`, e.doneOnB, 150_000, `${e.binding}'s outcome on B`);
  const firstRequestAt = Date.now();
  try {
    const report = await q.call<Report>(second, `/${e.binding}/evict/report`, { operationId: e.operationId });
    const killed = report.events.find((event) => event.kind === "request:submit")?.instance;
    const after = report.events.filter((event) => event.instance !== killed);
    return { receipt, inFlightAt, killedAt, restartedAt, doneLoggedAt: done.at, firstRequestAt, catalogCalls: q.guard.catalogCalls.filter((call) => call.title === e.hold),
      result: report.result, usage: report.usage, live: report.live, fauxCallsOnB: report.fauxCalls, transcript: steps(report.messages), extra: report.extra,
      killedInstance: killed, eventsAfterKill: after.map((event) => ({ instance: event.instance.slice(0, 8), kind: event.kind, at: event.at - killedAt, detail: event.detail })) };
  } finally {
    await second.dispose();
  }
}

/** The tool's catalog call is held in flight; kill once the wake job's 30 s heartbeat re-arm is durable (question 1's path). */
const afterAlarm = (q: Q3) => async (run: string) => {
  const alarmAt = (await q.log.waitFor(run, /\[spike\] alarm /, 30_000, `${run}'s first alarm`)).at;
  await sleep(alarmAt + 1_000 - Date.now());
};

/** The model request streams; kill 2.5 s in (a stored partial exists) and 1 s after the wake job's alarm. */
const midStream = (q: Q3) => async (run: string) => {
  const requestAt = (await q.log.waitFor(run, /\[spike\] model:request /, 30_000, `${run}'s model request`)).at;
  const alarmAt = (await q.log.waitFor(run, /\[spike\] alarm /, 30_000, `${run}'s first alarm`)).at;
  await sleep(Math.max(requestAt + 2_500, alarmAt + 1_000) - Date.now());
};

type Evicted = Awaited<ReturnType<typeof evict>>;
const onB = (run: Evicted) => run.eventsAfterKill;

function wakeChecks(check: Check, name: string, run: Evicted) {
  const answering = onB(run).find((event) => event.kind === "model:answer" || event.kind === "report" || event.kind === "model:request")?.instance;
  check.add(`${name}: the outcome arrived on a new instance in workerd B before any request, and the pi-wake job ran there`,
    run.firstRequestAt >= run.doneLoggedAt && onB(run).some((event) => event.instance === answering && event.kind === "job"), onB(run).map((event) => `${event.instance} ${event.kind}`));
}

async function replay(q: Q3) {
  const run = await evict(q, { binding: "replay", operationId: "op-replay", text: "Translate the anime titled \"Replay Probe\".", hold: "Replay Probe",
    killWhen: afterAlarm(q), doneOnB: /\[spike\] model:answer / });
  // The control for the billing check: the same tool, completing with no interruption, on another object.
  const control = await q.once("replay-control", async (mf) => {
    await q.call(mf, "/replay/control/submit", { text: "Translate the anime titled \"Replay Control\".", operationId: "op-control" });
    const report = await q.call<Report>(mf, "/replay/control/report", { operationId: "op-control" });
    return { result: report.result, usage: report.usage, reservations: report.extra?.reservations ?? [] };
  });
  const check = new Check();
  const controlTool = control.usage.tools?.translate_anime_title as { totalTokens?: number } | undefined;
  check.add("control: the same tool completing with no interruption is billed under tools, with its 10 tokens",
    control.result?.status === "done" && controlTool?.totalTokens === 10 && control.reservations.length === 1, control);
  const result = run.transcript.find((step) => step.kind === "pi.tool-result");
  check.add("A was SIGKILLed while translate_anime_title's catalog call was held in flight", run.catalogCalls[0]?.held === true && run.killedAt >= (run.inFlightAt ?? Infinity),
    { inFlightAt: run.inFlightAt, killedAt: run.killedAt });
  wakeChecks(check, "replay", run);
  check.add("the tool did not run again: one catalog call, no tool:start after the kill", run.catalogCalls.length === 1 && !onB(run).some((event) => event.kind === "tool:start"),
    run.catalogCalls);
  check.add("one reservation, made inside execute before the kill", (run.extra?.reservations ?? []).length === 1, run.extra);
  check.add("the model received an interrupted error result and answered from it", result?.isError === true && result.text.includes("interrupted")
    && run.result?.status === "done", { result, settled: run.result });
  check.add("Pi's usage counts nothing for the interrupted call: no translate_anime_title entry under tools", run.usage.tools?.translate_anime_title === undefined, run.usage);
  return { evidence: { ...run, control, provider: "faux" }, checks: check.items };
}

async function restart(q: Q3) {
  const noRetry = await evict(q, { binding: "restart-no-retry", operationId: "op-no-retry", text: "Answer at length.", killWhen: midStream(q), doneOnB: /\[spike\] report / });
  const retry = await evict(q, { binding: "restart-retry", operationId: "op-retry", text: "Answer at length.", killWhen: midStream(q), doneOnB: /\[spike\] model:request / });
  const limit = await evict(q, { binding: "restart-limit", operationId: "op-limit", text: "Resolve the anime titled \"Limit Probe\".", hold: "Limit Probe",
    killWhen: afterAlarm(q), doneOnB: /\[spike\] model:answer / });
  const check = new Check();
  for (const [name, run] of [["no retry left", noRetry], ["retry left", retry]] as const) {
    const aborted = run.transcript.find((step) => step.kind === "pi.assistant" && step.stopReason === "aborted");
    check.add(`${name}: the request was in flight at the kill, and its committed partial became an aborted entry`,
      aborted !== undefined && aborted.text.length > 0 && aborted.text.length < LONG_ANSWER.length, { aborted: aborted ? { chars: aborted.text.length, usage: aborted.usage } : null });
    wakeChecks(check, name, run);
  }
  check.add("no retry left (maxRetries 0): workerd B made no model request, and the run ended unanswered / interrupted",
    noRetry.fauxCallsOnB === 0 && !onB(noRetry).some((event) => event.kind === "model:request") && noRetry.result?.status === "unanswered"
      && noRetry.result.reason === "interrupted", { fauxCallsOnB: noRetry.fauxCallsOnB, result: noRetry.result, live: noRetry.live });
  check.add("no retry left: onReport received task_interrupted on B", onB(noRetry).some((event) => event.kind === "report" && event.detail?.kind === "task_interrupted"),
    onB(noRetry).filter((event) => event.kind === "report"));
  const constructed = (run: Evicted, instance: string) => onB(run).find((event) => event.instance === instance && event.kind === "constructed")?.at ?? NaN;
  const retryRequest = onB(retry).find((event) => event.kind === "model:request");
  const waitedMs = retryRequest ? retryRequest.at - constructed(retry, retryRequest.instance) : NaN;
  check.add("retry left (default policy): workerd B made exactly one model request, no earlier than the 2,000 ms backoff after its instance started",
    retry.fauxCallsOnB === 1 && waitedMs >= 1_950, { fauxCallsOnB: retry.fauxCallsOnB, waitedMs });
  check.add("retry left: the retry answered, after the aborted partial", retry.result?.status === "done"
    && retry.transcript.filter((step) => step.kind === "pi.assistant").map((step) => step.stopReason).join(",") === "aborted,stop", retry.transcript.map((step) => `${step.kind}:${step.stopReason ?? ""}`));
  const limitResult = limit.transcript.find((step) => step.kind === "pi.tool-result");
  check.add("restart limit lowered to 1 (default 5): the replay-safe tool cut off once is not run again", limit.catalogCalls.length === 1
    && !onB(limit).some((event) => event.kind === "tool:start"), limit.catalogCalls);
  check.add("restart limit: the model received the restart-limit error result and answered", limitResult?.isError === true
    && limitResult.text.includes("it is not run again") && limit.result?.status === "done", { limitResult, settled: limit.result });
  wakeChecks(check, "restart limit", limit);
  return { evidence: { noRetry, retry, limit, retryWaitedMs: waitedMs,
    provider: "faux, tokensPerSecond 20 for the two mid-stream kills; the aborted entry's usage is faux's whole up-front estimate (faux.js:234, :356)" }, checks: check.items };
}

const RUNNERS: Record<string, (q: Q3) => Promise<{ evidence: Record<string, unknown>; checks: CheckItem[] }>> = {
  admission, budget, stream, "web-results": webResults, replay, restart,
};

export const WORKERD_CASES: readonly string[] = Object.keys(RUNNERS);

export async function workerdCase(name: string) {
  const runner = RUNNERS[name];
  if (!runner) throw new Error(`no workerd case ${name}`);
  const work = mkdtempSync(join(tmpdir(), `pi-durable-spike-q3-${name}-`));
  const q = new Q3(await bundle("q3/q3.worker.ts", work), work);
  const { evidence, checks } = await runner(q);
  const t0 = q.log.lines[0]?.at ?? 0;
  checks.push({ name: "guard: no request other than the stubbed catalog left workerd", pass: q.guard.violations.length === 0, observed: q.guard.violations });
  return { evidence: { ...evidence, workerdLog: q.log.lines.map((line) => `+${String(line.at - t0).padStart(6)}ms ${line.run} ${line.stream}: ${line.text}`) }, checks };
}
