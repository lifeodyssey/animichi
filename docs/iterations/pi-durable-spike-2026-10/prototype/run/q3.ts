/**
 * Question 3, recorded: `node run/q3.ts --case <name>` runs one semantic-difference prototype and writes
 * `../evidence/q3-<name>.json`, then exits non-zero if any check failed, so the evidence exists for a failing run too.
 * `validation` runs in Node; every other case runs Pi in workerd at the edge's settings (`q3/q3.worker.ts`).
 */
import { validationRows } from "../q3/validation.ts";
import { writeEvidence } from "./workerd.ts";
import { Check, workerdCase, WORKERD_CASES } from "./q3-cases.ts";

async function validation() {
  const rows = validationRows();
  const check = new Check();
  const strings = rows.filter((row) => row.schemaSays === "string");
  check.add("every row: today's validator and pi-durable's return the same outcome and the same arguments", rows.every((row) => row.same),
    rows.filter((row) => !row.same));
  check.add("every number sent for a string property reaches execute as the string \"42\", under both",
    strings.every((row) => row.today.ok && row.piDurable.ok && (row.today.value as Record<string, unknown>)[row.property] === "42"
      && (row.piDurable.value as Record<string, unknown>)[row.property] === "42"), strings.map((row) => ({ tool: row.tool, property: row.property, today: row.today, piDurable: row.piDurable })));
  const integer = rows.find((row) => row.schemaSays === "integer");
  check.add("the string \"500\" sent for search_nearby's integer radius_m reaches execute as 500, under both",
    integer?.today.ok === true && integer.piDurable.ok && (integer.today.value as Record<string, unknown>).radius_m === 500
      && (integer.piDurable.value as Record<string, unknown>).radius_m === 500, integer);
  return { evidence: { rows }, checks: check.items };
}

const name = process.argv[process.argv.indexOf("--case") + 1] ?? "";
if (name !== "validation" && !WORKERD_CASES.includes(name)) throw new Error(`unknown case ${JSON.stringify(name)}; expected validation or ${WORKERD_CASES.join(", ")}`);
const { evidence, checks } = name === "validation" ? await validation() : await workerdCase(name);
writeEvidence(`q3-${name}.json`, { case: name, ...evidence, checks });
for (const item of checks) console.log(`${item.pass ? "PASS" : "FAIL"} ${item.name}`);
process.exitCode = checks.every((item) => item.pass) ? 0 : 1;
