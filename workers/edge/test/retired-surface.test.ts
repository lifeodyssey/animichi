import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { URL, fileURLToPath } from "node:url";

// EDGE-1 #963 deletion proof: retired surfaces must not survive anywhere in
// the edge source. Restoring a retired path — /v1/runtime (TURN-4 #955),
// /v1/users/sessions (SESSION-1 #959), /v1/users/saved-routes/claim (WEB-1
// #958) — or a Supabase JWT verifier (AUTH-2 #950) makes this file red.

const SRC_DIR = fileURLToPath(new URL("../src", import.meta.url));

function sourceFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) files.push(...sourceFiles(full));
    else if (entry.name.endsWith(".ts")) files.push(full);
  }
  return files;
}

const sources = sourceFiles(SRC_DIR).map((file) => readFileSync(file, "utf8"));

void test("no retired agent runtime path survives in the edge source", () => {
  assert.equal(sources.some((source) => source.includes("/v1/runtime")), false);
});

void test("no retired users surface survives in the edge source", () => {
  assert.equal(sources.some((source) => source.includes("/v1/users/sessions")), false);
  assert.equal(sources.some((source) => source.includes("/v1/users/saved-routes/claim")), false);
});

void test("the edge never verifies a Supabase JWT", () => {
  const verifyingLine = sources.some((source) =>
    source.split("\n").some((line) => /supabase/i.test(line) && /jwt/i.test(line)),
  );
  assert.equal(verifyingLine, false);
});
