/** Applying the committed `migrations/neon` Atlas chain to a clean database.
 *
 * This is the continuous "the chain applies cleanly" check: every arm that
 * boots this image proves the committed migrations against a database created
 * from pristine `template1`, with zero Neon credentials and zero network.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const MIGRATIONS_DIR = new URL("../../../migrations/neon/", import.meta.url);
const OUTPUT_CEILING_BYTES = 10 * 1024 * 1024;

function atlasBinary(): string {
  return process.env.ATLAS_BIN ?? "atlas";
}

/** Apply the committed migrations/neon chain to a clean database. */
export async function applyAtlasChain(dsn: string): Promise<void> {
  await promisify(execFile)(atlasBinary(), [
    "migrate", "apply",
    "--dir", MIGRATIONS_DIR.href,
    "--url", dsn,
    "--revisions-schema", "public",
  ], {
    env: { ...process.env, ATLAS_NO_UPDATE_NOTIFIER: "1" },
    maxBuffer: OUTPUT_CEILING_BYTES,
  });
}
