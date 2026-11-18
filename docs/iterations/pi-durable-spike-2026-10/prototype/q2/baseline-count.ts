/**
 * Today's store, the baseline: the edge's own one-turn host test, run alone and unchanged, between a reset of the
 * counter and a read. A container lane (the test boots or reuses the shared server through testcontainers), so the
 * coordinator runs it, after a frozen root install. It needs the counting control to have passed
 * (`../evidence/q2-count-control.json`).
 *
 * The test creates `native_host_contract_<suffix>`, runs one turn (POST /v1/chat, one model request calling the native
 * `respond` tool, settlement), then two history reads, and drops its database; the control showed that rows stay
 * attributed by name after the drop. Every statement in that database is listed with its tables and application
 * name, and the test's own setup and assertion statements (`host-integration-test/postgres.ts:16-28`,
 * `default-host.test.ts:11-50`) are separated by their text. Writes `../evidence/q2-baseline-count.json`.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { REPOSITORY } from "../run/bundle.ts";
import { sanitize, writeEvidence } from "../run/workerd.ts";
import { readCount, resetCounter, split, type CountedRow } from "./counter.ts";

const EDGE = join(REPOSITORY, "workers", "edge");
const TEST = ["--import", "tsx", "--test", "--test-isolation=none", "--test-concurrency=1",
  "--test-name-pattern", "production chat tier boots the default SessionAgent", "host-integration-test/default-host.test.ts"];
const DATABASE_LIKE = "native\\_host\\_contract\\_%";
const BUCKETS_MS = 10 * 60_000;

/** The test's own statements, by text: its setup (`postgres.ts`) and its assertion reads and writes (`default-host.test.ts`). */
const TEST_OWN: readonly RegExp[] = [
  /^CREATE FUNCTION host_test_/, /^CREATE TRIGGER host_test_/, /^TRUNCATE pi_sessions CASCADE/, /^DELETE FROM anon_daily_message_count/,
  /^DELETE FROM daily_usage/, /^DELETE FROM sessions WHERE id = \$1/, /^UNLISTEN \*/, /^LISTEN host_test_settled/,
  /^SELECT payload->'message' AS payload FROM pi_records/, /^SELECT a\.state,s\.last_usage_seq,s\.settled_at FROM agent_admissions/,
  /^SELECT message_count FROM anon_daily_message_count/, /^SELECT cost_usd FROM daily_usage/, /^UPDATE sessions SET user_id='another-owner'/,
];
const isTestOwn = (row: CountedRow) => TEST_OWN.some((pattern) => pattern.test(row.query.trimStart()));

if (!existsSync(join(EDGE, "node_modules", "tsx"))) {
  throw new Error("workers/edge has no installed dependencies: run `pnpm install --frozen-lockfile` at the worktree root first");
}

function run(): Promise<{ code: number | null; signal: string | null; output: string; ms: number }> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, TEST, { cwd: EDGE, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal, output: Buffer.concat(chunks).toString("utf8"), ms: Date.now() - started }));
  });
}

await resetCounter();
const test = await run();
const count = await readCount(DATABASE_LIKE);
const parts = split(count, isTestOwn);
const byApplication: Record<string, number> = {};
for (const row of parts.keptRows) byApplication[row.application ?? "(none)"] = (byApplication[row.application ?? "(none)"] ?? 0) + row.calls;
const summary = {
  command: `cd workers/edge && node ${TEST.map((part) => (part.includes(" ") ? JSON.stringify(part) : part)).join(" ")}`,
  testExit: { code: test.code, signal: test.signal, ms: test.ms, withinCounterBuckets: test.ms < BUCKETS_MS },
  databases: count.databases,
  total: count.total,
  testOwn: parts.excluded,
  rest: parts.kept,
  restByApplication: byApplication,
};
writeEvidence("q2-baseline-count.json", { summary, testOwnRows: parts.excludedRows, restRows: parts.keptRows });
writeEvidence("q2-baseline-test-output.txt", sanitize(test.output));
console.log(JSON.stringify(summary, null, 2));
for (const row of parts.keptRows) console.log(`${String(row.calls).padStart(4)}  ${row.cmd ?? ""}  [${row.relations ?? ""}]  ${row.query.replace(/\s+/g, " ").slice(0, 160)}`);
process.exitCode = test.code === 0 && count.databases.length === 1 && test.ms < BUCKETS_MS ? 0 : 1;
