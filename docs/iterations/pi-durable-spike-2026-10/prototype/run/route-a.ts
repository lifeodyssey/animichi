/**
 * Route (a), recorded: `node run/route-a.ts --crash a1|a2|a3|all`, `--case isolation`, `--case count`.
 * `q2/route-a.worker.ts` in workerd at the edge's settings: `PiHarness` on its own SQLite, each completed turn projected
 * into the spike's own Postgres database. Writes `../evidence/q2-route-a-<crash|case>.json`; exits non-zero if any check
 * failed. `count`, and the a3 recovery in `--crash`, reset the global statement counter: run them alone.
 */
import { PROJECTION_SCHEMA } from "../q2/route-a-schema.ts";
import { readCount, resetCounter } from "../q2/counter.ts";
import { Check } from "./b-prime-cases.ts";
import { PgWorkerd, sleep } from "./pg-workerd.ts";
import { writeEvidence } from "./workerd.ts";

interface Recomputed { readonly session: string; readonly sqliteBytes: number; readonly status: string | null; readonly recomputed: Record<string, unknown> | null }
const arg = (flag: string) => (process.argv.includes(flag) ? process.argv[process.argv.indexOf(flag) + 1] : undefined);
const crashArg = arg("--crash");
const caseArg = arg("--case");
const label = crashArg !== undefined ? `crash-${crashArg}` : caseArg ?? "";
const p = await PgWorkerd.create("q2/route-a.worker.ts", "spike_pi_durable_route_a", { ROUTE_A: "RouteA" }, {}, PROJECTION_SCHEMA);
const rand = () => crypto.randomUUID().slice(0, 8);
const rows = async (session: string) => (await p.rows(session, "SELECT seq::int, operation_id, record, octet_length(record) AS bytes FROM proj_turns WHERE session_id = $1 ORDER BY seq"))
  .map((row) => ({ seq: Number(row.seq), operationId: String(row.operation_id), record: JSON.parse(String(row.record)) as Record<string, unknown>, bytes: Number(row.bytes) }));
/** The fields the card compares: model, provider, per-call usage, tool calls and results, answer, status. */
const compared = (record: Record<string, unknown> | null | undefined) => JSON.stringify(record === null || record === undefined ? null
  : { model: record.model, provider: record.provider, calls: record.calls, toolCalls: record.toolCalls, toolResults: record.toolResults, answer: record.answer, status: record.status });

async function crash(point: string) {
  const name = `ra-${point}-${rand()}`;
  const operationId = `op-${point}`;
  const first = p.start(`${point}:A`, `persist-${point}`);
  await p.call(first, `/${name}/submit`, { session: name, operationId, text: "respond: A route (a) turn", crashAt: point });
  await p.after(`${point}:A`, new RegExp(`\\[spike\\] marker:${point} `), 0, 60_000, `${point}'s marker`);
  const killedAt = Date.now();
  await first.dispose();
  const backendGoneMs = await p.backendGone(`proj:${name}`);
  const atKill = await rows(name);
  if (point === "a3") await resetCounter();
  const second = p.start(`${point}:B`, `persist-${point}`);
  await second.ready;
  const projected = await p.after(`${point}:B`, new RegExp(`\\[spike\\] projected instance=\\S+ op=${operationId}$`), 0, 120_000, `${point}'s projection on B`);
  await sleep(300);
  const recoveryCount = point === "a3" ? (await readCount(p.database)).rows.filter((row) => row.application === `proj:${name}`) : undefined;
  try {
    const recomputed = await p.call<Recomputed>(second, `/${name}/recompute`, { operationId });
    return { point, name, operationId, killedAt, backendGoneMs, atKill: atKill.length, after: await rows(name), recomputed, projectedAfterKillMs: projected.at - killedAt,
      recoveryStatements: recoveryCount?.map((row) => ({ calls: row.calls, query: row.query.replace(/\s+/g, " ").slice(0, 120) })) };
  } finally {
    await second.dispose();
  }
}

async function crashes(points: string[]) {
  const runs = [];
  for (const point of points) runs.push(await crash(point));
  const check = new Check();
  const landed: Record<string, number> = { a1: 0, a2: 0, a3: 1 };
  const where: Record<string, string> = { a1: "Pi committed the turn; no projection row", a2: "the projection's transaction, held before COMMIT, rolled back with the connection: no row",
    a3: "the projection row committed; the object had not noted it" };
  for (const r of runs) {
    check.add(`${r.point}: the crash landed where intended (read from Postgres before the restart): ${where[r.point] ?? ""}; the killed process's connection was gone`,
      r.atKill === landed[r.point], { rowsAtKill: r.atKill, backendGoneMs: r.backendGoneMs });
    check.add(`${r.point}: after recovery with no request, exactly one row for the turn, equal to the projection recomputed from Pi's store (model, provider, per-call usage, tool calls and results, answer, status)`,
      r.after.length === 1 && r.recomputed.status === "done" && compared(r.after[0]?.record) === compared(r.recomputed.recomputed),
      { stored: r.after[0]?.record, recomputed: r.recomputed.recomputed });
  }
  const a3 = runs.find((r) => r.point === "a3");
  if (a3) check.add("a3: the re-projection wrote nothing twice (its insert found the row) and cost the write's three statements", (a3.recoveryStatements ?? [])
    .reduce((sum, row) => sum + row.calls, 0) === 3, a3.recoveryStatements);
  return { evidence: { runs }, checks: check.items };
}

async function isolation() {
  const mf = p.start("isolation");
  try {
    const sessions = [`ra-iso-a-${rand()}`, `ra-iso-b-${rand()}`];
    const since = Date.now();
    await Promise.all(sessions.map((name, index) => p.call(mf, `/${name}/submit`, { session: name, operationId: "op-iso", text: `respond: from session ${index === 0 ? "A" : "B"}` })));
    const deadline = Date.now() + 60_000;
    while (p.log.lines.filter((line) => line.at >= since && / projected instance=\S+ op=op-iso$/.test(line.text)).length < 2) {
      if (Date.now() > deadline) throw new Error("timed out waiting for both projections");
      await sleep(50);
    }
    const histories = await Promise.all(sessions.map((name) => rows(name)));
    const check = new Check();
    for (const [index, history] of histories.entries()) {
      const own = index === 0 ? "from session A" : "from session B";
      const other = index === 0 ? "from session B" : "from session A";
      check.add(`${sessions[index] ?? ""}: its history, read by session id, holds exactly its own turn`, history.length === 1
        && JSON.stringify(history[0]?.record).includes(own) && !JSON.stringify(history[0]?.record).includes(other), history);
    }
    check.add("both turns carry the same operation id and the same seq (each object's own Pi numbering), side by side under their session ids",
      histories.every((history) => history[0]?.operationId === "op-iso") && histories[0]?.[0]?.seq === histories[1]?.[0]?.seq, histories.map((h) => h.map((row) => row.seq)));
    return { evidence: { sessions, histories }, checks: check.items };
  } finally {
    await mf.dispose();
  }
}

async function counted(mf: ReturnType<typeof p.start>, name: string, operationId: string, text: string) {
  await resetCounter();
  const since = Date.now();
  await p.call(mf, `/${name}/submit`, { session: name, operationId, text });
  await p.after("count", new RegExp(`\\[spike\\] projected instance=\\S+ op=${operationId}$`), since, 60_000, `${name}'s projection`);
  await sleep(1_000);
  const counter = await readCount(p.database);
  const recomputed = await p.call<Recomputed>(mf, `/${name}/recompute`, { operationId });
  const statements = counter.rows.filter((row) => row.application === `proj:${name}`);
  return { name, operationId, statements: statements.reduce((sum, row) => sum + row.calls, 0), otherApplications: counter.rows.filter((row) => row.application !== `proj:${name}`).length,
    rows: statements.map((row) => ({ calls: row.calls, query: row.query.replace(/\s+/g, " ").slice(0, 120) })), stored: (await rows(name))[0]?.bytes, sqliteBytesAfter: recomputed.sqliteBytes };
}

async function count() {
  const mf = p.start("count");
  try {
    const respond = await counted(mf, `ra-count-${rand()}`, "op-count-1", "respond: A route (a) counted turn");
    const twoRequests = await counted(mf, `ra-count-q1-${rand()}`, "op-count-q1", "Resolve the anime titled \"Count Probe\"");
    const check = new Check();
    check.add("a cold one-request turn costs Postgres only its projection: BEGIN, one INSERT, COMMIT (Pi's own writes go to the object's SQLite)",
      respond.statements === 3 && respond.otherApplications === 0, respond);
    check.add("the q1-shaped turn's projection costs the same three statements", twoRequests.statements === 3, twoRequests);
    return { evidence: { respond, twoRequests }, checks: check.items };
  } finally {
    await mf.dispose();
  }
}

let result: { evidence: unknown; checks: { name: string; pass: boolean; observed: unknown }[] };
try {
  if (crashArg !== undefined) result = await crashes(crashArg === "all" ? ["a1", "a2", "a3"] : [crashArg]);
  else if (caseArg === "isolation") result = await isolation();
  else if (caseArg === "count") result = await count();
  else throw new Error("expected --crash a1|a2|a3|all or --case isolation|count");
} finally {
  await p.drop();
}
result.checks.push({ name: "guard: no request other than the stubbed catalog left workerd", pass: p.guard.violations.length === 0, observed: p.guard.violations });
const t0 = p.log.lines[0]?.at ?? 0;
writeEvidence(`q2-route-a-${label}.json`, { runtime: p.built.runtime, ...(result.evidence as object), checks: result.checks,
  workerdLog: p.log.lines.map((line) => `+${String(line.at - t0).padStart(6)}ms ${line.run} ${line.stream}: ${line.text}`) });
for (const item of result.checks) console.log(`${item.pass ? "PASS" : "FAIL"} ${item.name}`);
process.exitCode = result.checks.every((item) => item.pass) ? 0 : 1;
