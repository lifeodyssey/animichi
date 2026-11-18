/**
 * The baseline's split, recomputed offline from the committed count with its rule written out. `node q2/baseline-split.ts`
 * reads `../evidence/q2-baseline-count.json` and writes `../evidence/q2-baseline-split.json`; it touches no database.
 *
 * pg_stat_monitor sums `calls` per statement text, so one row can hold calls from more than one part. Calls are
 * allocated per statement family, in this order:
 * 1. the test's own: the count runner's patterns (`q2/baseline-count.ts:27-32`), checked against the rows it set aside;
 * 2. the two history GETs: both GETs' ownership check (`workers/edge/src/agent/views/history.ts:19`), and the first GET's
 *    six storage reads, three getValue, two scanValues and one scanBranch (`history.ts:41-58`,
 *    `history-operations.ts:7-14`); the second GET answers 404 after its ownership check;
 * 3. one Pi commit per `SELECT next_seq … FOR UPDATE`. Each holds one BEGIN, the lock, the validation SELECT, the ORM's
 *    pre-select and `UPDATE pi_sessions`, the session-stats aggregate and one COMMIT
 *    (`packages/pi-session-neon/src/commit.ts:41-52`, `session-stats.ts:14-28`), plus every write to a `pi_` table;
 * 4. the Pi session's creation;
 * 5. every other call goes to the part that owns its tables: `pg_stat_monitor`'s `relations`, or for a row without
 *    them the table it writes. Pi store (`public.pi_*`), Prisma's contract check (`information_schema`,
 *    `prisma_contract`), or our business tables (any other `public` table, plus the BEGIN and COMMIT left after step 3).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EVIDENCE, writeEvidence } from "../run/workerd.ts";

interface Row { readonly query: string; readonly cmd: string; readonly relations: string | null; readonly calls: number }
interface Count { readonly summary: { readonly total: number; readonly testOwn: number; readonly rest: number }; readonly testOwnRows: readonly Row[]; readonly restRows: readonly Row[] }
type Part = "test" | "history" | "pi.commit" | "pi.creation" | "pi.read" | "business" | "prisma";

/** Copied from `q2/baseline-count.ts:27-32` (importing that runner would run it); the checks confirm the copy. */
const TEST_OWN: readonly RegExp[] = [
  /^CREATE FUNCTION host_test_/, /^CREATE TRIGGER host_test_/, /^TRUNCATE pi_sessions CASCADE/, /^DELETE FROM anon_daily_message_count/,
  /^DELETE FROM daily_usage/, /^DELETE FROM sessions WHERE id = \$1/, /^UNLISTEN \*/, /^LISTEN host_test_settled/,
  /^SELECT payload->'message' AS payload FROM pi_records/, /^SELECT a\.state,s\.last_usage_seq,s\.settled_at FROM agent_admissions/,
  /^SELECT message_count FROM anon_daily_message_count/, /^SELECT cost_usd FROM daily_usage/, /^UPDATE sessions SET user_id='another-owner'/,
];
const FAMILY = {
  begin: /^BEGIN$/,
  commit: /^COMMIT$/,
  ownership: /^SELECT user_id AS owner FROM sessions WHERE id = \$1$/,
  getValue: /^SELECT "pi_scalar_values"\."value" AS "value", "pi_scalar_values"\."seq" AS "seq" FROM "public"\."pi_scalar_values" WHERE/,
  scanValues: /^SELECT key, seq, value FROM pi_scalar_values WHERE session_id = \$1/,
  scanBranch: /^WITH RECURSIVE ancestors AS /,
  lock: /^SELECT next_seq FROM pi_sessions WHERE id = \$1 FOR UPDATE$/,
  validation: /^SELECT "pi_records"\."id" AS "id", "pi_records"\."kind" AS "kind" FROM "public"\."pi_records" WHERE/,
  preSelect: /^SELECT "pi_sessions"\."id" AS "id" FROM "public"\."pi_sessions" WHERE "pi_sessions"\."id" = \$1 LIMIT 1$/,
  sessionUpdate: /^UPDATE "public"\."pi_sessions" SET "next_seq" = /,
  stats: /^SELECT jsonb_build_object\(/,
  write: /^(?:INSERT INTO|DELETE FROM|UPDATE) "public"\."pi_(?:records|list_values|scalar_values)" /,
  creation: /^INSERT INTO "public"\."pi_sessions" /,
} as const;
type Family = keyof typeof FAMILY;
const HISTORY_READS: readonly [Family, number][] = [["getValue", 3], ["scanValues", 2], ["scanBranch", 1]];
const PER_COMMIT: readonly Family[] = ["lock", "validation", "preSelect", "sessionUpdate", "stats"];

const count = JSON.parse(readFileSync(join(EVIDENCE, "q2-baseline-count.json"), "utf8")) as Count;
const rows = [...count.testOwnRows, ...count.restRows];
const text = (row: Row) => row.query.trimStart();
const left = new Map(rows.map((row) => [row, row.calls]));
const parts = new Map(rows.map((row) => [row, {} as Partial<Record<Part, number>>]));
const checks: { name: string; pass: boolean; observed: unknown }[] = [];
const sum = (values: Iterable<number>) => [...values].reduce((total, value) => total + value, 0);
const familyRows = (family: Family) => rows.filter((row) => FAMILY[family].test(text(row)));
const callsOf = (family: Family) => sum(familyRows(family).map((row) => row.calls));

function give(row: Row, part: Part, calls: number) {
  if (calls === 0) return;
  left.set(row, (left.get(row) ?? 0) - calls);
  const split = parts.get(row) ?? {};
  split[part] = (split[part] ?? 0) + calls;
}

/** Take `calls` for `part` from the rows in order; a family short of them is a failed check, not a silent shortfall. */
function take(from: readonly Row[], part: Part, calls: number) {
  let need = calls;
  for (const row of from) {
    const taken = Math.min(need, left.get(row) ?? 0);
    give(row, part, taken);
    need -= taken;
  }
  if (need !== 0) checks.push({ name: `${part}: enough calls in its family`, pass: false, observed: { short: need } });
}

const takeAll = (from: readonly Row[], part: Part) => { for (const row of from) give(row, part, left.get(row) ?? 0); };

function tables(row: Row): string[] {
  if (row.relations !== null) return row.relations.split(",").map((name) => name.replace(/\*$/, ""));
  const written = /^(?:INSERT INTO|UPDATE|DELETE FROM)\s+(?:"public"\."(\w+)"|(\w+))/.exec(text(row));
  return written ? [`public.${written[1] ?? written[2] ?? ""}`] : [];
}

function owner(row: Row): Part {
  const names = tables(row);
  if (names.some((name) => /^(?:information_schema|prisma_contract)\./.test(name))) return "prisma";
  if (names.length > 0 && names.every((name) => name.startsWith("public.pi_"))) return "pi.read";
  if (names.some((name) => name.startsWith("public.pi_"))) throw new Error(`a statement over Pi and other tables: ${text(row).slice(0, 80)}`);
  return "business";
}

const testRows = rows.filter((row) => TEST_OWN.some((pattern) => pattern.test(text(row))));
takeAll(testRows, "test");
takeAll(familyRows("ownership"), "history");
for (const [family, calls] of HISTORY_READS) take(familyRows(family), "history", calls);
const commits = callsOf("lock");
for (const family of ["begin", "commit", ...PER_COMMIT] as const) take(familyRows(family), "pi.commit", commits);
takeAll(familyRows("write"), "pi.commit");
takeAll(familyRows("creation"), "pi.creation");
for (const row of rows) give(row, owner(row), left.get(row) ?? 0);

const total = (part: Part) => sum([...parts.values()].map((split) => split[part] ?? 0));
const pi = { commits: total("pi.commit"), creation: total("pi.creation"), reads: total("pi.read") };
const piStore = pi.commits + pi.creation + pi.reads;
const turn = piStore + total("business") + total("prisma");
const sameRows = (a: readonly Row[], b: readonly Row[]) => JSON.stringify(a.map(text).sort()) === JSON.stringify(b.map(text).sort());
checks.push(
  { name: "the copied test patterns select exactly the rows the count runner set aside", pass: sameRows(testRows, count.testOwnRows), observed: { selected: testRows.length, setAside: count.testOwnRows.length } },
  { name: "both history GETs' ownership checks, and no other call of that statement", pass: callsOf("ownership") === 2, observed: callsOf("ownership") },
  { name: "BEGIN and COMMIT pair up", pass: callsOf("begin") === callsOf("commit"), observed: { begin: callsOf("begin"), commit: callsOf("commit") } },
  { name: "every call is allocated once", pass: [...left.values()].every((calls) => calls === 0) && total("test") + total("history") + turn === count.summary.total, observed: count.summary.total },
);

const statement = (row: Row) => text(row).replace(/\s+/g, " ").slice(0, 100);
const split = {
  source: "evidence/q2-baseline-count.json",
  total: count.summary.total,
  test: total("test"),
  history: { total: total("history"), ownershipChecks: callsOf("ownership"), firstGetReads: Object.fromEntries(HISTORY_READS) },
  turn: {
    total: turn,
    piStore: { total: piStore, commits: { count: commits, statements: pi.commits, perCommit: pi.commits / commits, writes: callsOf("write") }, readsOutsideCommits: pi.reads, sessionCreation: pi.creation },
    business: { total: total("business"), transactions: callsOf("begin") - commits, transactionsInAll: callsOf("begin") },
    prisma: total("prisma"),
  },
  checks,
  rows: rows.map((row) => ({ statement: statement(row), calls: row.calls, parts: parts.get(row) })),
};
writeEvidence("q2-baseline-split.json", split);
console.log(`total ${String(split.total)} = test ${String(split.test)} + history GETs ${String(split.history.total)} + turn ${String(turn)}`);
console.log(`turn ${String(turn)} = Pi store ${String(piStore)} + business ${String(split.turn.business.total)} + Prisma ${String(split.turn.prisma)}`);
console.log(`Pi store ${String(piStore)} = ${String(commits)} commits of ${String(pi.commits)} statements (${String(pi.commits / commits)} each; ${String(callsOf("write"))} writes) + ${String(pi.reads)} reads outside commits + ${String(pi.creation)} session creation`);
console.log(`business ${String(split.turn.business.total)}, with ${String(split.turn.business.transactions)} of the ${String(split.turn.business.transactionsInAll)} transactions`);
for (const item of checks) console.log(`${item.pass ? "PASS" : "FAIL"} ${item.name}`);
process.exitCode = checks.every((item) => item.pass) ? 0 : 1;
