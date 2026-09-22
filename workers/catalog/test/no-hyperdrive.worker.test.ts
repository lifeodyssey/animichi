import { describe, expect, it } from "vitest";
import wranglerToml from "../wrangler.toml?raw";

/**
 * No Hyperdrive anywhere in the catalog (#1628).
 *
 * The worker carried a COMMENTED `[[hyperdrive]]` binding and a
 * `env.HYPERDRIVE.connectionString` preference branch in `connectionString()`.
 * A permanently disabled binding reads as live policy, and the preference branch
 * was the only reason the binding looked like one — spec §4.2. Both are gone, and
 * this test is the tripwire: a re-added binding, a re-added branch, or a comment
 * that reintroduces the option reads as a failure rather than as a plan.
 *
 * `?raw` inlines the files at transform time (the technique
 * `wrangler-private.worker.test.ts` uses), so this runs in the worker pool with
 * the sandboxed filesystem never touched.
 */

const sourceTree = import.meta.glob<string>("../src/**/*.ts", { query: "?raw", eager: true, import: "default" });

/** Every `src/` file that still mentions Hyperdrive, as `path: line`. */
function hyperdriveMentions(): string[] {
  const mentions: string[] = [];
  for (const [key, text] of Object.entries(sourceTree)) {
    text.split("\n").forEach((line, index) => {
      if (/hyperdrive/i.test(line)) mentions.push(`${key.replace(/^\.\.\//u, "")}:${String(index + 1)}`);
    });
  }
  return mentions;
}

describe("the catalog has no Hyperdrive binding", () => {
  it("declares no hyperdrive binding in wrangler.toml, commented out or not", () => {
    expect(wranglerToml).not.toMatch(/hyperdrive/iu);
  });

  it("reads no hyperdrive binding in src/", () => {
    expect(hyperdriveMentions()).toEqual([]);
  });

  it("has no connection-string preference branch left (the env slice is DATABASE_URL only)", () => {
    expect(sourceTree["../src/db/connections.ts"]).toContain("DATABASE_URL");
    expect(sourceTree["../src/index.ts"]).toContain("DATABASE_URL");
  });
});
