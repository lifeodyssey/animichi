/**
 * Admission against Pi's commit, route (b′), recorded: `node run/b-prime-admission.ts --crash c1|c2|c3|c4|all`.
 * One fresh session per crash point, on `PrimeAdmitted` (admission, recovery scan and settlement on every wake), with
 * the interval scan shrunk to 2 s as the edge's own lane shrinks it (`FAST_RECOVERY_SCAN`):
 * - c1: after the admission commit, before the wake is armed and before `submit`;
 * - c2: during `submit`: Pi's commit of the submission is held before its `COMMIT`, so the kill rolls it back;
 * - c3: after Pi's commit of the submission, before anything else (the next commit is held);
 * - c4: after Pi settled, before settlement commits.
 * The runner SIGKILLs workerd at the marker, proves from Postgres where the crash landed and that the killed process's
 * backends are gone, restarts with no request, waits for the settlement, and checks that the admission row, Pi's
 * submission and the settlement row agree, with the charge recomputed from the stored entries. Writes
 * `../evidence/q2-b-prime-admission.json`; exits non-zero if any check failed.
 */
import { BUSINESS_SCHEMA } from "../q2/b-prime/business.ts";
import { chargeOf } from "../q2/b-prime/charge.ts";
import { Check } from "./b-prime-cases.ts";
import { PgWorkerd, sleep } from "./pg-workerd.ts";
import { writeEvidence } from "./workerd.ts";

const POINTS = ["c1", "c2", "c3", "c4"] as const;
type Point = typeof POINTS[number];
const STATE = `SELECT (SELECT state FROM biz_admissions WHERE session_id = $1) AS admission,
  (SELECT count(*)::int FROM biz_settlements WHERE session_id = $1) AS settlements,
  (SELECT charged_tokens::int FROM biz_settlements WHERE session_id = $1) AS charged,
  (SELECT first_entry::int FROM biz_settlements WHERE session_id = $1) AS first_entry,
  (SELECT last_entry::int FROM biz_settlements WHERE session_id = $1) AS last_entry,
  (SELECT count(*)::int FROM pd_submissions WHERE session_key = $1) AS pi_submissions,
  (SELECT string_agg(status, ',') FROM pd_submissions WHERE session_key = $1) AS pi_status,
  (SELECT count(*)::int FROM pd_entries WHERE session_key = $1 AND record LIKE '%"kind":"pi.user"%') AS user_entries,
  (SELECT count(*)::int FROM pd_entries WHERE session_key = $1 AND record LIKE '%"kind":"pi.tool-result"%') AS tool_results,
  (SELECT count(*)::int FROM pd_entries WHERE session_key = $1) AS entries`;
interface State { admission: string | null; settlements: number; charged: number | null; first_entry: number | null; last_entry: number | null;
  pi_submissions: number; pi_status: string | null; user_entries: number; tool_results: number; entries: number }
interface Event { readonly instance: string; readonly kind: string; readonly detail: { banked?: number; charged?: number } | null; readonly at: number }

const requested = process.argv[process.argv.indexOf("--crash") + 1] ?? "all";
const points = requested === "all" ? [...POINTS] : POINTS.filter((point) => point === requested);
if (points.length === 0) throw new Error(`unknown crash point ${JSON.stringify(requested)}; expected c1, c2, c3, c4 or all`);

const p = await PgWorkerd.create("q2/b-prime.worker.ts", "spike_pi_durable_admission", { ADMITTED: "PrimeAdmitted" }, { WAKE_INTERVAL_S: "2" }, BUSINESS_SCHEMA);

async function recomputed(name: string, state: State) {
  if (state.first_entry === null || state.last_entry === null) return null;
  const rows = await p.rows(name, `SELECT record FROM pd_entries WHERE session_key = $1 AND id BETWEEN ${String(state.first_entry)} AND ${String(state.last_entry)} ORDER BY id`);
  return chargeOf(rows.map((row) => JSON.parse(String(row.record)) as { id: number; model?: unknown[] }));
}

async function crash(point: Point) {
  const name = `adm-${point}-${crypto.randomUUID().slice(0, 8)}`;
  const operationId = `op-${point}`;
  const first = p.start(`${point}:A`, `persist-${point}`);
  const pending = p.call(first, `/admitted/${name}/admit`, { operationId, text: "respond: Admitted and answered", crashAt: point })
    .catch((error: unknown) => ({ error: String(error).slice(0, 200) }));
  const marker = await p.after(`${point}:A`, new RegExp(`\\[spike\\] marker:${point} `), 0, 60_000, `${point}'s marker`);
  const killedAt = Date.now();
  await first.dispose();
  const answerOnA = await pending;
  const backendGoneMs = { pi: await p.backendGone(`pi:${name}`), biz: await p.backendGone(`biz:${name}`) };
  const atKill = (await p.rows(name, STATE))[0] as unknown as State;
  const second = p.start(`${point}:B`, `persist-${point}`);
  await second.ready;
  const settledLine = await p.after(`${point}:B`, new RegExp(`\\[spike\\] settled instance=\\S+ op=${operationId}`), 0, 120_000, `${point}'s settlement on B`);
  await sleep(500);
  const after = (await p.rows(name, STATE))[0] as unknown as State;
  try {
    const report = await p.call<{ events: Event[] }>(second, `/admitted/${name}/report`, { operationId });
    const killed = report.events.find((event) => event.kind === "request:admit")?.instance;
    const onB = report.events.filter((event) => event.instance !== killed);
    return { point, name, operationId, markerAt: marker.at, killedAt, answerOnA, backendGoneMs, atKill, after, charge: await recomputed(name, after),
      settledAfterKillMs: settledLine.at - killedAt, eventsOnB: onB.map((event) => ({ instance: event.instance.slice(0, 8), kind: event.kind, at: event.at - killedAt, detail: event.detail })) };
  } finally {
    await second.dispose();
  }
}

const runs: Awaited<ReturnType<typeof crash>>[] = [];
try {
  for (const point of points) runs.push(await crash(point));
} finally {
  await p.drop();
}

const check = new Check();
const LANDED: Record<Point, (s: State) => boolean> = {
  c1: (s) => s.admission === "admitted" && s.pi_submissions === 0 && s.settlements === 0,
  c2: (s) => s.admission === "admitted" && s.pi_submissions === 0 && s.entries === 0 && s.settlements === 0,
  c3: (s) => s.admission === "admitted" && s.pi_submissions === 1 && s.tool_results === 0 && s.settlements === 0,
  c4: (s) => s.admission === "admitted" && s.pi_status === "done" && s.settlements === 0,
};
const WHERE: Record<Point, string> = {
  c1: "the admission committed; Pi has no submission; nothing settled",
  c2: "the admission committed; Pi's held commit rolled back with the connection: no submission, no entry; nothing settled",
  c3: "the admission committed; Pi's submission committed; no tool result yet; nothing settled",
  c4: "the admission committed; Pi settled the submission done; nothing settled by us",
};
for (const r of runs) {
  const resubmitted = r.eventsOnB.some((event) => event.kind === "recover:resubmit");
  const banked = r.eventsOnB.filter((event) => event.kind === "settled").map((event) => event.detail?.banked);
  check.add(`${r.point}: the crash landed where intended (read from Postgres before the restart): ${WHERE[r.point]}; the killed process's backends were gone`,
    LANDED[r.point](r.atKill), { atKill: r.atKill, backendGoneMs: r.backendGoneMs });
  check.add(`${r.point}: with no request, recovery realigned all three: admission settled, one Pi submission (done) with one user entry, one settlement row`,
    r.after.admission === "settled" && r.after.pi_submissions === 1 && r.after.pi_status === "done" && r.after.user_entries === 1 && r.after.settlements === 1, r.after);
  check.add(`${r.point}: no double charge: settled once (banked ${JSON.stringify(banked)}), charging exactly the operation's own usage, recomputed from the stored entries`,
    JSON.stringify(banked) === "[1]" && r.charge !== null && r.charge.total > 0 && r.after.charged === r.charge.total, { charged: r.after.charged, recomputed: r.charge });
  check.add(`${r.point}: the recovery path: ${r.point === "c1" || r.point === "c2" ? "the scan submitted the admitted operation again under its id" : "no resubmission; Pi resumed or had settled"}`,
    (r.point === "c1" || r.point === "c2") === resubmitted, r.eventsOnB.map((event) => `${event.instance} ${event.kind}`));
}
check.add("guard: no request other than the stubbed catalog left workerd", p.guard.violations.length === 0, p.guard.violations);
const t0 = p.log.lines[0]?.at ?? 0;
writeEvidence(`q2-b-prime-admission${requested === "all" ? "" : `-${requested}`}.json`, { runtime: p.built.runtime, runs, checks: check.items,
  workerdLog: p.log.lines.map((line) => `+${String(line.at - t0).padStart(6)}ms ${line.run} ${line.stream}: ${line.text}`) });
for (const item of check.items) console.log(`${item.pass ? "PASS" : "FAIL"} ${item.name}`);
process.exitCode = check.items.every((item) => item.pass) ? 0 : 1;
