/** The dry-run bound is a diagnostic for a stalled build; it must never relabel a failed one (#1677 review). */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundleLikeWrangler } from "./wrangler-bundle.ts";

const directory = mkdtempSync(join(tmpdir(), "edge-wrangler-bundle-"));
after(() => { rmSync(directory, { recursive: true, force: true }); });

void test("a failed dry-run build keeps the build's own error instead of the timeout diagnostic", async () => {
  const entry = join(directory, "does-not-compile.ts");
  writeFileSync(entry, 'export default { fetch() { return new Response("unterminated); } }\n');
  await assert.rejects(bundleLikeWrangler(entry, join(directory, "broken.js")), (error: unknown) => {
    const failure = error as Error & { killed?: boolean; signal?: string | null };
    assert.doesNotMatch(failure.message, /did not finish its dry-run build within \d+ seconds/);
    assert.match(failure.message, /does-not-compile\.ts/, "the compiler's own message must survive");
    assert.equal(failure.killed, false, "the child exited on its own; the timeout never killed it");
    assert.equal(failure.signal, null);
    return true;
  });
});
