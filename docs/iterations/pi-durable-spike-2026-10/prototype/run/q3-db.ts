/**
 * Question 3's two database cases, on route (b′) with its covering layers (`PrimeDouble`: admission, recovery scan,
 * settlement; the ported provider double). `node run/q3-db.ts --case settlement|selection`; writes
 * `../evidence/q3-<case>.json` and exits non-zero if any check failed. The spike measures; it does not choose a
 * billing rule: the prototype's settlement banks each operation's own entry range when Pi settles it `done`, and
 * nothing for one Pi settles `unanswered`.
 */
import type { Miniflare } from "miniflare";
import { BUSINESS_SCHEMA } from "../q2/b-prime/business.ts";
import { chargeOf } from "../q2/b-prime/charge.ts";
import { Check } from "./b-prime-cases.ts";
import { PgWorkerd, sleep } from "./pg-workerd.ts";
import { summarize } from "./q1-scenarios.ts";
import { writeEvidence } from "./workerd.ts";

interface Usage { readonly totalTokens: number }
interface Report { readonly settled: { status: string; reason?: string } | null; readonly usage: { models?: Record<string, Usage>; tools?: Record<string, Usage> };
  readonly messages: Parameters<typeof summarize>[0]; readonly events: { kind: string; detail: unknown; at: number; instance: string }[] }
interface EntryRow { readonly id: number; readonly kind: string; readonly model?: { role: string; stopReason?: string; usage?: Usage; errorMessage?: string }[] }
interface Settlement { operation_id: string; outcome: string; charged_tokens: string; first_entry: string | null; last_entry: string | null }

const name = process.argv[process.argv.indexOf("--case") + 1] ?? "";
const p = await PgWorkerd.create("q2/b-prime.worker.ts", `spike_pi_durable_q3_${name}`, { DOUBLE: "PrimeDouble" }, { WAKE_INTERVAL_S: "2" }, BUSINESS_SCHEMA);
const session = `${name}-${crypto.randomUUID().slice(0, 8)}`;
const sumUsage = (usage: Report["usage"]) => [...Object.values(usage.models ?? {}), ...Object.values(usage.tools ?? {})].reduce((total, item) => total + item.totalTokens, 0);

async function settled(run: string, operationId: string, timeoutMs = 120_000) {
  return p.after(run, new RegExp(`\\[spike\\] settled instance=\\S+ op=${operationId}$`), 0, timeoutMs, `${operationId}'s settlement on ${run}`);
}

async function entries(): Promise<EntryRow[]> {
  return (await p.rows(session, "SELECT record FROM pd_entries WHERE session_key = $1 ORDER BY id")).map((row) => JSON.parse(String(row.record)) as EntryRow);
}

async function settlements(): Promise<Settlement[]> {
  return await p.rows(session, "SELECT operation_id, outcome, charged_tokens::text, first_entry::text, last_entry::text FROM biz_settlements WHERE session_id = $1 ORDER BY settled_at") as unknown as Settlement[];
}

// ── settlement ───────────────────────────────────────────────────────────────────────────────────────────────────

const OPS = [
  { id: "op-1", text: "turn: the first completed turn" },
  { id: "op-2", text: "fail-4xx: a request the gateway rejects" },
  { id: "op-3", text: "fail-frame: a failed attempt as an error frame" },
  { id: "op-4", text: "interrupt: an answer cut off by a kill" },
  { id: "op-5", text: "turn: the second completed turn" },
  { id: "op-6", text: "turn: a turn on a gateway not asked for usage" },
] as const;

async function settlement() {
  const at = (action: string) => `/double/${session}/${action}`;
  let mf: Miniflare = p.start("A", "persist");
  for (const op of OPS.slice(0, 3)) {
    await p.call(mf, at("admit"), { operationId: op.id, text: op.text });
    await settled("A", op.id);
  }
  const interrupted = OPS[3];
  void p.call(mf, at("admit"), { operationId: interrupted.id, text: interrupted.text }).catch(() => undefined);
  const streaming = await p.after("A", /\[spike\] double:request /, Date.now() - 50, 30_000, "the interrupt attempt to reach the double");
  await sleep(2_500);
  const killedAt = Date.now();
  await mf.dispose();
  await p.backendGone(`pi:${session}`);
  const atKill = await entries();
  // The streamed partial Pi had persisted (its progress commits), read from the document rows before the restart.
  const partialAtKill = Number((await p.rows(session, `SELECT count(*)::int AS n FROM pd_document_revisions WHERE session_key = $1 AND content LIKE '%word0 %'`))[0]?.n ?? 0);
  mf = p.start("B", "persist");
  await mf.ready;
  await settled("B", interrupted.id);
  await p.call(mf, at("admit"), { operationId: OPS[4].id, text: OPS[4].text });
  await settled("B", OPS[4].id);
  await p.call(mf, at("use-model"), { modelId: "double-silent" });
  await p.call(mf, at("admit"), { operationId: OPS[5].id, text: OPS[5].text });
  await settled("B", OPS[5].id);
  await sleep(500);
  const report = await p.call<Report>(mf, at("report"), { operationId: OPS[5].id });
  await mf.dispose();
  const stored = await entries();
  const banked = await settlements();
  const charge = (s: Settlement) => (s.first_entry === null || s.last_entry === null ? null
    : chargeOf(stored.filter((entry) => entry.id >= Number(s.first_entry) && entry.id <= Number(s.last_entry))));
  const inCompleted = (id: number) => banked.some((s) => s.first_entry !== null && s.last_entry !== null && id >= Number(s.first_entry) && id <= Number(s.last_entry));
  const all = chargeOf(stored);
  const uncharged = chargeOf(stored.filter((entry) => !inCompleted(entry.id)));
  const total = sumUsage(report.usage);
  const by = (id: string) => banked.find((s) => s.operation_id === id);
  const aborted = stored.filter((entry) => entry.model?.some((message) => message.role === "assistant" && message.stopReason === "aborted"));
  const failedEntries = stored.filter((entry) => entry.model?.some((message) => message.role === "assistant" && message.stopReason === "error"));
  const check = new Check();
  check.add("every operation settled once: op-1, op-4, op-5, op-6 done; op-2 (4xx thrown) and op-3 (error frame) unanswered, banked nothing",
    banked.length === 6 && ["op-1", "op-4", "op-5", "op-6"].every((id) => by(id)?.outcome === "done") && ["op-2", "op-3"].every((id) => by(id)?.outcome === "unanswered"
      && Number(by(id)?.charged_tokens) === 0), banked);
  for (const id of ["op-1", "op-4", "op-5", "op-6"]) {
    const s = by(id);
    check.add(`${id}: charged exactly the usage inside its own entry range, recomputed from the stored entries`, s !== undefined && Number(s.charged_tokens) === charge(s)?.total,
      { charged: s?.charged_tokens, range: [s?.first_entry, s?.last_entry], recomputed: s ? charge(s) : null });
  }
  check.add("two completed turns, op-1 and op-5, are each charged only their own usage (14 each: two model calls of 2 and the tool's 10), never the session's running total",
    Number(by("op-1")?.charged_tokens) === 14 && Number(by("op-5")?.charged_tokens) === 14 && total > 28, { op1: by("op-1")?.charged_tokens, op5: by("op-5")?.charged_tokens, usageTotal: total });
  check.add("the identity: Pi's usage() total equals the stored entries' usage, which equals the completed operations' charges plus the usage outside them",
    total === all.total && all.total === banked.reduce((sum, s) => sum + Number(s.charged_tokens), 0) + uncharged.total,
    { usageTotal: total, entriesTotal: all.total, charged: banked.reduce((sum, s) => sum + Number(s.charged_tokens), 0), uncharged: uncharged.total, unchargedCalls: uncharged.calls });
  check.add("the interrupted attempt: before the restart Postgres held op-4's streamed partial (a progress commit) and no answer to it; after it Pi kept an aborted entry inside op-4's range with the usage the partial carried (none: the double reports usage only in its final frame)",
    partialAtKill > 0 && !atKill.some((entry) => entry.model?.some((message) => message.role === "assistant" && message.stopReason === "aborted"))
      && aborted.length === 1 && (aborted[0]?.model?.[0]?.usage?.totalTokens ?? -1) === 0
      && Number(by("op-4")?.first_entry) <= (aborted[0]?.id ?? 0) && (aborted[0]?.id ?? Infinity) <= Number(by("op-4")?.last_entry),
    { partialRevisionsAtKill: partialAtKill, entriesAtKill: atKill.length, aborted, killedAt, streamingAt: streaming.at });
  check.add("op-6, on the model whose compat does not ask for usage: its model calls carry no usage, so it is charged only the tool's 10", Number(by("op-6")?.charged_tokens) === 10, charge(by("op-6") as Settlement));
  return { evidence: { session, settlements: banked, usage: report.usage, usageTotal: total, entriesUsage: all, uncharged, aborted, failedEntries,
    entriesAtKill: atKill.length, transcript: summarize(report.messages), provider: "the ported provider double (q2/b-prime/double.ts); faux is not used in this case" }, checks: check.items };
}

// ── selection ────────────────────────────────────────────────────────────────────────────────────────────────────

async function selection() {
  const at = (action: string) => `/double/${session}/${action}`;
  const mf = p.start("S", "persist");
  try {
    const first = await p.call<{ status: number; submission?: number; settled?: string }>(mf, at("select"), { operationId: "op-sel", choice: "itinerary A" });
    const again = await p.call<{ status: number; submission?: number; settled?: string }>(mf, at("select"), { operationId: "op-sel", choice: "itinerary A" });
    const other = await p.call<{ status: number }>(mf, at("select"), { operationId: "op-sel", choice: "itinerary B" });
    await p.call(mf, at("admit"), { operationId: "op-after", text: "turn: a model turn after the selection" });
    await settled("S", "op-after");
    const report = await p.call<Report>(mf, at("report"), { operationId: "op-after" });
    const stored = await entries();
    const banked = await settlements();
    const submissions = await p.rows(session, "SELECT status, request_id FROM pd_submissions WHERE session_key = $1 ORDER BY id");
    const admissions = await p.rows(session, "SELECT operation_id, kind, state FROM biz_admissions WHERE session_id = $1 ORDER BY created_at");
    const modelRequests = report.events.filter((event) => event.kind === "double:request");
    const selectionAt = report.events.filter((event) => event.kind === "request:select").map((event) => event.at);
    const check = new Check();
    const selectionEntries = stored.filter((entry) => entry.kind === "animichi.selection");
    check.add("first selection: admitted (202), Pi settled the write done at once, no model request", first.status === 202 && first.settled === "done"
      && !modelRequests.some((event) => event.at <= Math.max(...selectionAt)), { first, modelRequestsBeforeTheModelTurn: modelRequests.filter((event) => event.at <= Math.max(...selectionAt)).length });
    check.add("the same id and content again: the existing admission (200) and Pi's same submission; one selection entry", again.status === 200
      && again.submission === first.submission && selectionEntries.length === 1, { again, selectionEntries: selectionEntries.length });
    check.add("the same id with other content: 409 at admission; Pi never sees it", other.status === 409 && selectionEntries.length === 1
      && submissions.filter((row) => String(row.request_id).includes("op-sel")).length === 1, { other, submissions });
    check.add("settled through the same settlement, charging nothing: one row, done, 0 tokens", banked.filter((s) => s.operation_id === "op-sel").length === 1
      && banked.find((s) => s.operation_id === "op-sel")?.outcome === "done" && Number(banked.find((s) => s.operation_id === "op-sel")?.charged_tokens) === 0, banked);
    check.add("a model turn after it runs and settles as usual", banked.find((s) => s.operation_id === "op-after")?.outcome === "done", { admissions, banked });
    return { evidence: { session, first, again, other, submissions, admissions, settlements: banked, selectionEntries, transcript: summarize(report.messages),
      provider: "none for the selection; the ported double for the model turn after it" }, checks: check.items };
  } finally {
    await mf.dispose();
  }
}

const CASES: Record<string, () => Promise<{ evidence: unknown; checks: { name: string; pass: boolean; observed: unknown }[] }>> = { settlement, selection };
const runner = CASES[name];
if (!runner) throw new Error(`unknown case ${JSON.stringify(name)}; expected settlement or selection`);
let result: Awaited<ReturnType<typeof runner>>;
try {
  result = await runner();
} finally {
  await p.drop();
}
result.checks.push({ name: "guard: no request other than the stubbed catalog left workerd", pass: p.guard.violations.length === 0, observed: p.guard.violations });
const t0 = p.log.lines[0]?.at ?? 0;
writeEvidence(`q3-${name}.json`, { case: name, runtime: p.built.runtime, ...(result.evidence as object), checks: result.checks,
  workerdLog: p.log.lines.map((line) => `+${String(line.at - t0).padStart(6)}ms ${line.run} ${line.stream}: ${line.text}`) });
for (const item of result.checks) console.log(`${item.pass ? "PASS" : "FAIL"} ${item.name}`);
process.exitCode = result.checks.every((item) => item.pass) ? 0 : 1;
