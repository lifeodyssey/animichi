// SUT: infra/database-access/reset-staging-baseline.sh — the neonctl it runs. It used to
// fetch neonctl from the registry on every staging deploy (`npx --yes`). It now runs the neonctl
// `infra` declares through the catalog, at the version the lockfile resolved and CD's root
// `pnpm install --frozen-lockfile` puts in place before the step, through the one function every
// Neon call in the script goes through, with neonctl's analytics turned off by its global
// `--no-analytics` flag. A call that skips that function and fetches a CLI is the harness's to
// catch (its `npx` double refuses, and its neonctl double refuses a call without the flag).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { URL, fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string): string => readFileSync(`${ROOT}${path}`, "utf8");

void test("every Neon call goes through infra's installed neonctl, with its analytics off", () => {
  const sh = read("infra/database-access/reset-staging-baseline.sh");
  assert.match(sh, /^neonctl\(\) \{ pnpm --dir "\$ROOT\/infra" exec neonctl --no-analytics "\$@"; \}$/m);
});
