import { describe, expect, it } from "vitest";
// `?raw` inlines the file at transform time, so this runs in the worker pool
// with the sandboxed filesystem never touched (the technique
// `wrangler-private.worker.test.ts` documents).
import toml from "../wrangler.toml?raw";

/**
 * The catalog's refusal alarm (#1784) is one structured `console.error` record
 * with `event: "ingest.upstream_refused"`. Cloudflare Workers Issues detects
 * error-level logs and groups them into an issue a notification can be routed
 * from — but only while the Worker's observability is on, and only while Issues
 * itself is enabled. Both are declared here so a config edit cannot silently
 * turn the only signal this card delivers back off.
 *
 * Wrangler treats `observability` as inheritable — the same `inheritable(...)`
 * normalization `wrangler-private.worker.test.ts` documents for `workers_dev` —
 * so the top-level block governs staging and production. The last test refuses
 * an environment override, which is the one edit that would break that
 * inheritance without touching this block.
 */

const contentLines = (source: string): string[] =>
  source.split("\n").map((line) => line.trim()).filter((line) => !line.startsWith("#"));

/** The lines of the `header` block, ending at the next section header. */
function block(header: string): string[] {
  const lines = contentLines(toml);
  const start = lines.indexOf(header);
  if (start === -1) throw new Error(`wrangler.toml must contain a "${header}" section`);
  const rest = lines.slice(start + 1);
  const nextHeader = rest.findIndex((line) => line.startsWith("["));
  return nextHeader === -1 ? rest : rest.slice(0, nextHeader);
}

function valueIn(header: string, key: string): string {
  const found = block(header).find((line) => line.startsWith(`${key} = `));
  if (found === undefined) throw new Error(`"${header}" must set ${key}`);
  return found.slice(key.length + 3).trim();
}

describe("the catalog's logs reach Cloudflare so the refusal alarm can be routed", () => {
  it("keeps observability and its logs enabled at 100% sampling", () => {
    expect(valueIn("[observability]", "enabled")).toBe("true");
    expect(valueIn("[observability]", "head_sampling_rate")).toBe("1");
    expect(valueIn("[observability.logs]", "enabled")).toBe("true");
    expect(valueIn("[observability.logs]", "head_sampling_rate")).toBe("1");
    expect(valueIn("[observability.logs]", "persist")).toBe("true");
  });

  it("enables Workers Issues, the half that turns the event into a notification", () => {
    expect(valueIn("[observability.issues]", "enabled")).toBe("true");
  });

  it("declares no environment observability override, so staging and production inherit the block above", () => {
    const overrides = contentLines(toml).filter((line) => /^\[env\.[A-Za-z0-9_-]+\.observability(\.[^\]]+)?\]$/u.test(line));
    expect(overrides).toEqual([]);
  });
});
