/**
 * The receipt's two checks of the migrator's schema view, run as CD runs them: the recorder's
 * (`record-receipt.mjs`, through `appliedSchema` in `.github/lib/release/observations.mjs`) under
 * node, and the verifier's (`verify-receipt.rb`, through `ReleaseReceipt.validate_schema`) under
 * ruby. Each takes a `/preflight` answer and the contract hash the bundle packages, so the workerd
 * suite hands them the deployed entry's own answer with nothing in between.
 */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const RELEASE_LIB = fileURLToPath(new URL("../../../../.github/lib/release/", import.meta.url).href);
const RECORD = `import { appliedSchema } from ${JSON.stringify(join(RELEASE_LIB, "observations.mjs"))};
appliedSchema(JSON.parse(process.argv[1]), process.argv[2]);`;
const VERIFY = `require "json"; require ${JSON.stringify(join(RELEASE_LIB, "receipt.rb"))}
ReleaseReceipt.validate_schema(JSON.parse(ARGV[0]), ARGV[1])`;

/** The contract hash a built bundle packages, read where CD reads it: `contract.json`'s storage hash. */
export async function packagedPrismaRef(bundle: string): Promise<string> {
  const contract = JSON.parse(await readFile(join(bundle, "contract.json"), "utf8")) as { storage: { storageHash: string } };
  return contract.storage.storageHash;
}

function stderrOf(error: unknown): string {
  return typeof error === "object" && error !== null && "stderr" in error && typeof error.stderr === "string" ? error.stderr : "";
}

/** One check's verdict: `accepted`, or `refused:` followed by what it printed. */
async function verdict(command: string, args: readonly string[]): Promise<string> {
  try {
    await promisify(execFile)(command, [...args]);
    return "accepted";
  } catch (error) {
    return `refused: ${stderrOf(error).trim()}`;
  }
}

/** Both receipt checks' verdicts on one schema view. */
export async function receiptVerdicts(schema: unknown, prismaRef: string): Promise<{ record: string; verify: string }> {
  const body = JSON.stringify(schema);
  return {
    record: await verdict(process.execPath, ["--input-type=module", "--eval", RECORD, body, prismaRef]),
    verify: await verdict("ruby", ["-e", VERIFY, body, prismaRef]),
  };
}
