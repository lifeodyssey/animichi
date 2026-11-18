/**
 * Route (b′), recorded: `node run/b-prime.ts --case count|isolation|wake`. Each run creates the spike's own database
 * `spike_pi_durable_bprime`, applies the backend's schema, runs `q2/b-prime.worker.ts` in workerd at the edge's settings
 * with the outbound guard, writes `../evidence/q2-b-prime-<case>.json`, drops the database, and exits non-zero if any
 * check failed. `count` resets the global statement counter: run it alone.
 */
import { count, isolation, wake, type CheckItem } from "./b-prime-cases.ts";
import { PgWorkerd } from "./pg-workerd.ts";
import { writeEvidence } from "./workerd.ts";

const CASES: Record<string, (p: PgWorkerd) => Promise<{ evidence: unknown; checks: CheckItem[] }>> = { count, isolation, wake };
const name = process.argv[process.argv.indexOf("--case") + 1] ?? "";
const runner = CASES[name];
if (!runner) throw new Error(`unknown case ${JSON.stringify(name)}; expected ${Object.keys(CASES).join(", ")}`);

const p = await PgWorkerd.create("q2/b-prime.worker.ts", "spike_pi_durable_bprime", { SAFE: "PrimeSafe", UNSAFE: "PrimeUnsafe", STREAMED: "PrimeStreamed" });
let result: { evidence: unknown; checks: CheckItem[] };
try {
  result = await runner(p);
} finally {
  await p.drop();
}
result.checks.push({ name: "guard: no request other than the stubbed catalog left workerd", pass: p.guard.violations.length === 0, observed: p.guard.violations });
const t0 = p.log.lines[0]?.at ?? 0;
writeEvidence(`q2-b-prime-${name}.json`, { case: name, runtime: p.built.runtime, ...(result.evidence as object), checks: result.checks,
  workerdLog: p.log.lines.map((line) => `+${String(line.at - t0).padStart(6)}ms ${line.run} ${line.stream}: ${line.text}`) });
for (const item of result.checks) console.log(`${item.pass ? "PASS" : "FAIL"} ${item.name}`);
process.exitCode = result.checks.every((item) => item.pass) ? 0 : 1;
