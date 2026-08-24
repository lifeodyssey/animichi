import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { URL, fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const PROMOTION = readFileSync(`${ROOT}.github/scripts/promote-release-unit.sh`, "utf8");
interface PackageManifest {
  devDependencies?: Record<string, string>;
}
const DEPLOY_PACKAGES = [
  "package.json",
  "apps/web/package.json",
  "workers/catalog/package.json",
  "workers/users/package.json",
].map((name) => JSON.parse(readFileSync(`${ROOT}${name}`, "utf8")) as PackageManifest);

void test("artifact promotion uses the locked workspace Wrangler", () => {
  assert.match(PROMOTION, /pnpm --dir "\$GITHUB_WORKSPACE" exec wrangler/);
  assert.doesNotMatch(PROMOTION, /\bnpx\b[^\n]*\bwrangler(?:@|\b)/);
  assert.doesNotMatch(PROMOTION, /wrangler@latest|wranglerVersion:/);
});

void test("deploy packages declare Wrangler", () => {
  DEPLOY_PACKAGES.forEach((manifest) => {
    assert.equal(typeof manifest.devDependencies?.wrangler, "string");
  });
});
