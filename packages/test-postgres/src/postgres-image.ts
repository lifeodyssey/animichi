/** The offline Postgres + PostGIS + pgvector image every test arm boots.
 *
 * The tag itself is NOT written here. `scripts/local-gates/db-fresh-schema.sh`
 * needs the same tag and is bash, which cannot import a module, so the one
 * declaration lives in `postgres-image.env`: the gate sources that file and
 * this module reads it. `test/image-tag-contract.test.ts` resolves the tag
 * through both paths and fails when they disagree.
 *
 * `URL` comes from `node:url` and not from the ambient global: `workers/catalog`
 * compiles this file under `@cloudflare/workers-types`, whose `URL` is a
 * different type and is not what `readFileSync` accepts.
 */
import { readFileSync } from "node:fs";
import { URL } from "node:url";

const IMAGE_DECLARATION = new URL("../postgres-image.env", import.meta.url);
/** The shell assignment `postgres-image.env` exports, anchored to its own line. */
const ASSIGNMENT = /^TEST_POSTGRES_IMAGE=(.+)$/m;

function declaredImage(): string {
  const declared = ASSIGNMENT.exec(readFileSync(IMAGE_DECLARATION, "utf8"))?.[1];
  if (declared === undefined) {
    throw new Error("postgres-image.env declares no TEST_POSTGRES_IMAGE");
  }
  return declared.trim();
}

export const OFFLINE_POSTGRES_IMAGE = declaredImage();
