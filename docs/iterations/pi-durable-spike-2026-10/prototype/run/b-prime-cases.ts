/**
 * Route (b′)'s cases on `q2/b-prime.worker.ts`: b′3 statements per turn, b′1 two-object isolation (with its shared-key
 * negative control), b′2 our own wake across a SIGKILL during a tool call. Each returns its evidence and its checks.
 */
import type { Miniflare } from "miniflare";
import { keyOf } from "../q2/b-prime/key.ts";
import { readCount, resetCounter, type Count, type CountedRow } from "../q2/counter.ts";
import { summarize } from "./q1-scenarios.ts";
import { PgWorkerd, sleep, type Event } from "./pg-workerd.ts";
import { withTimeout } from "./workerd.ts";

export interface CheckItem { readonly name: string; readonly pass: boolean; readonly observed: unknown }
export class Check {
  readonly items: CheckItem[] = [];
  add(name: string, pass: boolean, observed: unknown) { this.items.push({ name, pass, observed }); }
}

interface Report { readonly instance: string; readonly key: string; readonly settled: { status: string; reason?: string; answer?: number } | null;
  readonly messages: Parameters<typeof summarize>[0]; readonly usage: unknown; readonly events: Event[] }

const run = () => crypto.randomUUID().slice(0, 8);
const sum = (rows: readonly CountedRow[]) => rows.reduce((total, row) => total + row.calls, 0);

/** One object's statements, by what they are: open, commits (BEGIN, state read, write, COMMIT), reads. */
export function attribute(count: Count, key: string) {
  const rows = count.rows.filter((row) => row.application === `pi:${key}`);
  const text = (row: CountedRow) => row.query.replace(/\s+/g, " ").trim();
  const kind = (row: CountedRow) => {
    const query = text(row);
    if (query === "BEGIN") return "begin";
    if (query === "COMMIT") return "commit";
    if (query === "ROLLBACK") return "rollback";
    if (query.startsWith("WITH meta AS MATERIALIZED")) return "stateRead";
    if (query.startsWith("INSERT INTO pd_meta")) return "open";
    if (/^(WITH w0 AS|INSERT INTO pd_|UPDATE pd_meta|DELETE FROM pd_)/.test(query)) return "write";
    return "read";
  };
  const byKind: Record<string, number> = {};
  for (const row of rows) byKind[kind(row)] = (byKind[kind(row)] ?? 0) + row.calls;
  return { statements: sum(rows), byKind, commits: byKind.begin ?? 0, otherApplications: sum(count.rows.filter((row) => row.application !== `pi:${key}`)),
    rows: rows.map((row) => ({ calls: row.calls, kind: kind(row), relations: row.relations, query: text(row).slice(0, 140) })) };
}

async function turn(p: PgWorkerd, mf: Miniflare, label: string, binding: string, name: string, operationId: string, text: string) {
  await resetCounter();
  const since = Date.now();
  const receipt = await p.call(mf, `/${binding}/${name}/submit`, { operationId, text });
  const last = await p.after(label, /\[spike\] (tool:respond|model:answer) /, since, 60_000, `${name}'s last model-side step`);
  await p.after(label, /\[spike\] wake:end /, last.at, 60_000, `${name}'s wake to end after the run`);
  await sleep(1_500);
  const counted = attribute(await readCount(p.database), keyOf(name));
  const report = await p.call<Report>(mf, `/${binding}/${name}/report`, { operationId });
  const steps = summarize(report.messages);
  // This turn only: its steps from its own user entry on, and the model events after its submit.
  return { name, operationId, text, receipt, counted, settled: report.settled, transcript: steps.slice(steps.map((step) => step.kind).lastIndexOf("pi.user")),
    modelCalls: report.events.filter((event) => event.at >= since && (event.kind === "model:tool_call" || event.kind === "model:answer")).length };
}

async function idleWake(p: PgWorkerd, mf: Miniflare, label: string, name: string) {
  await resetCounter();
  const since = Date.now();
  await p.call(mf, `/safe/${name}/arm-wake`, {});
  await p.after(label, /\[spike\] wake:end /, since, 60_000, `${name}'s idle wake`);
  await sleep(1_500);
  return { name, counted: attribute(await readCount(p.database), keyOf(name)) };
}

// ── b′3: statements per turn ─────────────────────────────────────────────────────────────────────────────────────

export async function count(p: PgWorkerd) {
  const mf = p.start("count");
  const id = run();
  try {
    const cold = await turn(p, mf, "count", "safe", `count-${id}`, "op-count-1", "respond: Hello from route b-prime");
    const warm = await turn(p, mf, "count", "safe", `count-${id}`, "op-count-2", "respond: A second turn in the same session");
    const idle = await idleWake(p, mf, "count", `count-${id}`);
    const streamed = await turn(p, mf, "count", "streamed", `count-streamed-${id}`, "op-count-s", "respond: A streamed answer");
    const twoRequests = await turn(p, mf, "count", "safe", `count-q1-${id}`, "op-count-q1", "Resolve the anime titled \"Count Probe\"");
    const check = new Check();
    for (const t of [cold, warm, streamed]) {
      check.add(`${t.name} ${t.operationId}: one model request calling respond, which ended the run; settled done`, t.settled?.status === "done" && t.modelCalls === 1
        && t.transcript.filter((step) => step.kind === "pi.assistant").length === 1 && t.transcript.some((step) => step.kind === "pi.tool-result" && step.toolName === "respond"),
      { settled: t.settled, modelCalls: t.modelCalls, kinds: t.transcript.map((step) => step.kind) });
    }
    check.add("q1-shaped turn: tool call, result, answer; settled done", twoRequests.settled?.status === "done", twoRequests.transcript.map((step) => step.kind));
    check.add("every counted statement is the object's own connection (no other application in the database)",
      [cold, warm, streamed, twoRequests].every((t) => t.counted.otherApplications === 0) && idle.counted.otherApplications === 0, null);
    check.add("statements per commit are 4 (BEGIN, state read, write, COMMIT): begins = state reads = writes = commits in every count",
      [cold, warm, streamed, twoRequests].every((t) => t.counted.byKind.begin === t.counted.byKind.stateRead && t.counted.byKind.stateRead === t.counted.byKind.write
        && t.counted.byKind.write === t.counted.byKind.commit), [cold, warm, streamed, twoRequests].map((t) => t.counted.byKind));
    return { evidence: { cold, warm, idle, streamed, twoRequests }, checks: check.items };
  } finally {
    await mf.dispose();
  }
}

// ── b′1: two-object isolation ────────────────────────────────────────────────────────────────────────────────────

const KEYSPACE_ROWS = `SELECT 'conversation' AS t, id::text AS id, xmin::text AS xmin, record AS body FROM pd_conversations WHERE session_key = $1
UNION ALL SELECT 'entry', id::text, xmin::text, record FROM pd_entries WHERE session_key = $1
UNION ALL SELECT 'task', id::text, xmin::text, record FROM pd_tasks WHERE session_key = $1
UNION ALL SELECT 'submission', id::text, xmin::text, record FROM pd_submissions WHERE session_key = $1
UNION ALL SELECT 'document', id::text, xmin::text, record FROM pd_documents WHERE session_key = $1
UNION ALL SELECT 'revision', document_id::text || ':' || seq::text, xmin::text, content FROM pd_document_revisions WHERE session_key = $1
UNION ALL SELECT 'record_id', id::text, xmin::text, record_type FROM pd_record_ids WHERE session_key = $1`;

interface Row { readonly t: string; readonly id: string; readonly xmin: string; readonly body: string }

function span(report: Report) {
  const moves = report.events.filter((event) => event.kind.startsWith("model:") || event.kind.startsWith("tool:"));
  return { first: moves[0]?.at ?? NaN, last: moves.at(-1)?.at ?? NaN };
}

async function pair(p: PgWorkerd, mf: Miniflare, names: readonly string[], titles: readonly string[], operationIds: readonly string[]) {
  const submitted = await Promise.all(names.map((name, index) => p.call(mf, `/streamed/${name}/submit`, { operationId: operationIds[index], text: `Resolve the anime titled "${titles[index] ?? ""}"` })
    .catch((error: unknown) => ({ error: String(error) }))));
  const reports = await Promise.all(names.map((name, index) => withTimeout(p.call<Report>(mf, `/streamed/${name}/report`, { operationId: operationIds[index] }), 45_000, `${name}'s report`)
    .catch((error: unknown) => ({ error: String(error) }))));
  return { submitted, reports };
}

export async function isolation(p: PgWorkerd) {
  const mf = p.start("isolation");
  const id = run();
  try {
    const names = [`iso-a-${id}`, `iso-b-${id}`];
    const titles = ["Isolation A", "Isolation B"];
    const { reports } = await pair(p, mf, names, titles, ["op-iso", "op-iso"]);
    const [a, b] = reports as [Report, Report];
    const rows = await Promise.all(names.map((name) => p.rows(name, KEYSPACE_ROWS))) as unknown as [Row[], Row[]];
    const shared = [`shared-${id}~a`, `shared-${id}~b`];
    const control = await pair(p, mf, shared, ["Shared A", "Shared B"], ["op-shared-a", "op-shared-b"]);
    const sharedRows = await p.rows(`shared-${id}`, KEYSPACE_ROWS) as unknown as Row[];
    const check = new Check();
    const [spanA, spanB] = [span(a), span(b)];
    check.add("the two turns ran at the same time (each started before the other ended)", spanA.first < spanB.last && spanB.first < spanA.last, { spanA, spanB });
    for (const [index, report] of [a, b].entries()) {
      const own = titles[index] ?? "";
      const other = titles[1 - index] ?? "";
      const keyspace = rows[index] ?? [];
      const steps = summarize(report.messages);
      check.add(`${names[index] ?? ""}: Pi settled op-iso done, and messages() hold only its own turn`, report.settled?.status === "done"
        && steps.filter((step) => step.kind === "pi.user").length === 1 && JSON.stringify(steps).includes(own) && !JSON.stringify(steps).includes(other), steps);
      check.add(`${names[index] ?? ""}: every row of its keyspace belongs to its own turn (the other title appears nowhere)`,
        keyspace.length > 0 && keyspace.some((row) => row.body.includes(own)) && keyspace.every((row) => !row.body.includes(other)), { rows: keyspace.length });
    }
    const ids = (keyspace: Row[], t: string) => keyspace.filter((row) => row.t === t).map((row) => Number(row.id)).sort((x, y) => x - y);
    check.add("both keyspaces hold the same entry ids, the same root conversation 1 and the same request id op-iso, side by side",
      JSON.stringify(ids(rows[0], "entry")) === JSON.stringify(ids(rows[1], "entry")) && ids(rows[0], "conversation")[0] === 1 && ids(rows[1], "conversation")[0] === 1
        && rows.every((keyspace) => keyspace.filter((row) => row.t === "submission" && row.body.includes("\"requestId\":\"op-iso\"")).length === 1),
      { entriesA: ids(rows[0], "entry"), entriesB: ids(rows[1], "entry") });
    const xmins = rows.map((keyspace) => new Set(keyspace.map((row) => row.xmin)));
    const crossing = [...(xmins[0] ?? [])].filter((xmin) => xmins[1]?.has(xmin));
    check.add("no row was written by the other object: no transaction id appears in both keyspaces' row versions (xmin)", crossing.length === 0,
      { transactionsA: xmins[0]?.size, transactionsB: xmins[1]?.size, crossing });
    const sharedText = JSON.stringify(sharedRows.map((row) => row.body));
    const collided = (sharedText.includes("Shared A") && sharedText.includes("Shared B")) || control.reports.some((report) => "error" in report
      || (report as Report).settled?.status !== "done");
    check.add("negative control: two objects on one session key collide (both turns land in one keyspace, or one of them fails)", collided,
      { reports: control.reports.map((report) => ("error" in report ? report : { settled: (report as Report).settled, users: summarize((report as Report).messages)
        .filter((step) => step.kind === "pi.user").map((step) => step.text) })), sharedRowCount: sharedRows.length });
    return { evidence: { names, reports: [a, b].map((report) => ({ ...report, transcript: summarize(report.messages), messages: undefined })), rowCounts: rows.map((r) => r.length),
      xmins: xmins.map((set) => set.size), control: { names: shared, reports: control.reports, sharedRowCount: sharedRows.length } }, checks: check.items };
  } finally {
    await mf.dispose();
  }
}

// ── b′2: our own wake ────────────────────────────────────────────────────────────────────────────────────────────

async function evict(p: PgWorkerd, binding: "safe" | "unsafe", title: string) {
  const name = `wake-${binding}`;
  const operationId = `op-wake-${binding}`;
  const hold = p.guard.holdFirstCall(title);
  const first = p.start(`${binding}:A`, `persist-${binding}`);
  const receipt = await p.call(first, `/${binding}/${name}/submit`, { operationId, text: `Resolve the anime titled "${title}"` });
  const inFlightAt = await withTimeout(hold.inFlight, 60_000, `${binding}'s held catalog call`);
  const waitingAt = (await p.after(`${binding}:A`, /\[spike\] wake:waiting /, 0, 30_000, `${binding}'s wake to wait on A`)).at;
  await sleep(1_000);
  const killedAt = Date.now();
  await first.dispose();
  hold.release();
  const backendGoneMs = await p.backendGone(`pi:${name}`);
  const atKill = await p.rows(name, `SELECT (SELECT status FROM pd_submissions WHERE session_key = $1) AS submission,
    (SELECT count(*)::int FROM pd_entries WHERE session_key = $1 AND record LIKE '%"kind":"pi.tool-result"%') AS tool_results,
    (SELECT count(*)::int FROM pd_entries WHERE session_key = $1) AS entries`);
  const second = p.start(`${binding}:B`, `persist-${binding}`);
  await second.ready;
  const answer = await p.after(`${binding}:B`, /\[spike\] model:answer /, 0, 150_000, `${binding}'s answer on B`);
  const firstRequestAt = Date.now();
  try {
    const report = await p.call<Report>(second, `/${binding}/${name}/report`, { operationId });
    const killed = report.events.find((event) => event.kind === "request:submit")?.instance;
    const after = report.events.filter((event) => event.instance !== killed);
    return { binding, name, operationId, receipt, inFlightAt, waitingAt, killedAt, backendGoneMs, atKill: atKill[0], answerLoggedAt: answer.at, firstRequestAt,
      catalogCalls: p.guard.catalogCalls.filter((call) => call.title === title), settled: report.settled, transcript: summarize(report.messages), killed,
      eventsAfterKill: after.map((event) => ({ instance: event.instance.slice(0, 8), kind: event.kind, at: event.at - killedAt, detail: event.detail })) };
  } finally {
    await second.dispose();
  }
}

export async function wake(p: PgWorkerd) {
  const runs = [await evict(p, "safe", "Wake Safe"), await evict(p, "unsafe", "Wake Unsafe")];
  const check = new Check();
  for (const r of runs) {
    const beforeRequest = r.eventsAfterKill.filter((event) => !event.kind.startsWith("request:") || event.kind === "request:arm-wake");
    const firstRequest = r.eventsAfterKill.findIndex((event) => event.kind.startsWith("request:"));
    const onB = r.eventsAfterKill.slice(0, firstRequest === -1 ? undefined : firstRequest);
    const answering = onB.find((event) => event.kind === "model:answer")?.instance;
    const wakeStart = onB.findIndex((event) => event.instance === answering && event.kind === "wake:start");
    const firstMove = onB.findIndex((event) => event.instance === answering && (event.kind === "tool:start" || event.kind === "model:answer"));
    check.add(`${r.binding}: A was SIGKILLed while the tool's catalog call was held, after the wake had begun waiting`, r.catalogCalls[0]?.held === true
      && r.killedAt >= r.inFlightAt && r.killedAt >= r.waitingAt, { inFlightAt: r.inFlightAt, waitingAt: r.waitingAt, killedAt: r.killedAt });
    check.add(`${r.binding}: the crash point landed: before B started, Postgres held the submission placed and no tool result, and A's backend was gone`,
      r.atKill?.submission === "placed" && r.atKill.tool_results === 0, { atKill: r.atKill, backendGoneMs: r.backendGoneMs });
    check.add(`${r.binding}: on B, with no request sent, the SDK's wakeSession job started before anything moved the turn, and the answer came before any request`,
      answering !== undefined && wakeStart !== -1 && wakeStart < firstMove && r.firstRequestAt >= r.answerLoggedAt, onB.map((event) => `${event.instance} ${event.kind}`));
    check.add(`${r.binding}: Pi settled the operation done`, r.settled?.status === "done", r.settled);
    void beforeRequest;
  }
  const [safe, unsafe] = runs as [typeof runs[0], typeof runs[0]];
  const toolResult = (r: typeof safe) => r.transcript.find((step) => step.kind === "pi.tool-result");
  check.add("safe: the tool ran again after the kill (two catalog calls), and its successful result reached the model", safe.catalogCalls.length === 2
    && toolResult(safe)?.isError === false, { calls: safe.catalogCalls, result: toolResult(safe) });
  check.add("unsafe: the tool did not run again (one catalog call); the model received the interrupted result", unsafe.catalogCalls.length === 1
    && toolResult(unsafe)?.isError === true && (toolResult(unsafe)?.text ?? "").includes("was interrupted"), { calls: unsafe.catalogCalls, result: toolResult(unsafe) });
  return { evidence: { runs: runs.map((r) => ({ ...r, timing: { killToAnswerMs: r.answerLoggedAt - r.killedAt } })) }, checks: check.items };
}
