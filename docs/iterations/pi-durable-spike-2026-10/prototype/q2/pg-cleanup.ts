/**
 * The spike's last step on the test server: drop every database of its own, the counter included, and show that none
 * is left. `node q2/pg-cleanup.ts`; writes `../evidence/q2-pg-cleanup.json`. Only names matching the spike's prefix are
 * read from the catalog, and each passes `own()` before it is dropped. Each runner already drops its own database when
 * it finishes; this also catches the counter and anything a failed run left.
 */
import { ADMIN_DSN, COUNTER_DATABASE, dropDatabase, own, withClient } from "./pg-admin.ts";
import { writeEvidence } from "../run/workerd.ts";

const KNOWN = ["admission", "bprime", "conformance", "control", "q3_selection", "q3_settlement", "route_a"].map((suffix) => `spike_pi_durable_${suffix}`);
const PREFIX = String.raw`spike\_pi\_durable\_%`;

const listed = (): Promise<string[]> => withClient(ADMIN_DSN, async (client) =>
  (await client.query<{ datname: string }>("SELECT datname FROM pg_database WHERE datname LIKE $1 ORDER BY datname", [PREFIX])).rows.map((row) => row.datname),
"pi-durable-spike-admin");

const before = await listed();
const targets = [...new Set([...before, ...KNOWN, COUNTER_DATABASE])].map(own);
for (const name of targets) await dropDatabase(name);
const after = await listed();
writeEvidence("q2-pg-cleanup.json", { at: new Date().toISOString(), before, dropped: targets, after, pass: after.length === 0 });
console.log(`before: ${before.join(", ") || "(none)"}`);
console.log(`after: ${after.join(", ") || "(none)"}`);
console.log(after.length === 0 ? "PASS no spike database left" : "FAIL spike databases remain");
process.exitCode = after.length === 0 ? 0 : 1;
