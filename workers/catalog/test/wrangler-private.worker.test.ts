import { describe, expect, it } from "vitest";
// `?raw` inlines the file at transform time, so by the time this runs inside
// workerd the config is just a string constant — no filesystem is touched.
//
// AGENTS.md routes "filesystem parity checks" to the *.spike.test.ts Node pool.
// That rule exists because the worker pool's filesystem is sandboxed, which
// does not apply to a transform-time inline; and following it here would be
// actively harmful — the spike pool's globalSetup skips the whole suite without
// NEON_API_KEY/NEON_PROJECT_ID, so this guard would silently vanish in CI. A
// skipped guard is not a guard.
import toml from "../wrangler.toml?raw";

// catalog has no `routes` in any environment, and wrangler resolves
// `defaultWorkersDev = routes.length === 0` — so every environment that does
// not say `workers_dev = false` is published on `*.workers.dev` BY DEFAULT.
//
// This is not hypothetical. `[env.preview]` declared it, `[env.staging]` and
// `[env.production]` did not, and `catalog-staging.<account>.workers.dev` was
// answering unauthenticated requests with real data. The Worker's entire
// security model is the comment at worker/app.ts:330 ("catalog is private,
// reached via service binding") — nothing in the request tells catalog whether
// a caller came through the binding or off the open internet.
//
// Parsing here is deliberately line-based rather than via a TOML library: the
// point is to assert on the file a human edits, and adding a parser dependency
// to guard three lines is a worse trade than a strict reader that fails loudly
// on anything it does not understand.

interface Section {
  name: string;
  lines: string[];
}

const sections = (toml: string): Section[] => {
  let current: Section = { name: "top-level", lines: [] };
  const out: Section[] = [current];
  const open = (name: string): void => {
    current = { name, lines: [] };
    out.push(current);
  };
  for (const raw of toml.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("#")) continue;
    const header = /^\[(env\.[A-Za-z0-9_-]+)\]$/.exec(line);
    // A sub-table ([env.staging.vars], [[env.staging.r2_buckets]]) ends the
    // environment's own key list; keys after it belong to the sub-table.
    if (header?.[1]) open(header[1]);
    else if (line.startsWith("[")) open(`${current.name}:subtable`);
    else current.lines.push(line);
  }
  return out;
};

const environments = (toml: string): Section[] =>
  sections(toml).filter((s) => s.name === "top-level" || /^env\.[A-Za-z0-9_-]+$/.test(s.name));

describe("catalog is not published on workers.dev", () => {
  it("declares no routes, so workers_dev cannot be left to its default", () => {
    expect(toml).not.toMatch(/^\s*routes\s*=/m);
  });

  it.each(environments(toml).map((s) => s.name))(
    "%s sets workers_dev = false explicitly",
    (name) => {
      const section = environments(toml).find((s) => s.name === name);
      expect(section?.lines).toContain("workers_dev = false");
    },
  );

  it("finds every environment the file actually declares", () => {
    // Guards the parser itself: if a new [env.X] is added and this list is not
    // updated, the count assertion fails and the per-environment case above
    // cannot silently skip it.
    expect(environments(toml).map((s) => s.name)).toEqual([
      "top-level",
      "env.staging",
      "env.production",
      "env.preview",
    ]);
  });
});
