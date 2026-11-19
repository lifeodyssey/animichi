// infra/database-access/reset-staging-baseline.sh, sourced: the shipped functions run as written,
// and a test replaces only the ones that would reach Neon, each by the answer its case needs.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { URL, fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../../../infra/database-access/reset-staging-baseline.sh", import.meta.url));

export interface Outcome { status: number | null; stdout: string; stderr: string }

// Every Neon call the script makes goes through its `neonctl`, so that one function refuses
// until a case answers it, and `npx` refuses outright: a case that forgets to replace a read fails
// here instead of sending a request to the Neon API.
const NO_NEON = `neonctl() { echo "neonctl must not run in this test: $*" >&2; return 97; }
npx() { echo "npx must not run in this test: $*" >&2; return 97; }`;

export const sourcedResetScript = (body: string): Outcome => {
  const result = spawnSync("bash", ["-c", `set -euo pipefail\nsource "${SCRIPT}"\n${NO_NEON}\n${body}`], { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
};

// An approval record written to a temporary file, for a case that must not read the committed one.
export const withRecordFile = <T>(lines: string, check: (record: string) => T): T => {
  const dir = mkdtempSync(join(tmpdir(), "reset-record-"));
  const record = join(dir, "record");
  writeFileSync(record, lines);
  try {
    return check(record);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
};
