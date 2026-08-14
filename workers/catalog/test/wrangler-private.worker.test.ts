import { describe, expect, it } from "vitest";
// `?raw` inlines the file at transform time, so by the time this runs inside
// workerd the config is just a string constant — no filesystem is touched.
//
// AGENTS.md routes "filesystem parity checks" to the *.spike.test.ts Node pool.
// That rule exists because the worker pool's filesystem is sandboxed, which
// does not apply to a transform-time inline; and following it here would be
// actively harmful — the `catalog-spikes` CI job's `if:` restricts it to
// workflow_dispatch and same-repo pull_request, so on a push to main (and on
// any fork PR) it does not run at all. A guard that does not run is not a guard.
import toml from "../wrangler.toml?raw";

// catalog must have no public host. Two independent defaults would give it
// one, and both were live:
//
//   workers_dev  — catalog declares no `routes`, and wrangler resolves
//                  `defaultWorkersDev = routes.length === 0`, so leaving the
//                  key out publishes the Worker.
//   preview_urls — leaving the key out sends no `previews_enabled` at all, so
//                  the server keeps Cloudflare's enabled-by-default state: a
//                  public URL per deployed version, with real bindings.
//
// Not hypothetical. `catalog-staging.<account>.workers.dev` was answering
// unauthenticated requests with real data.
//
// Do NOT cite workers/edge/app.ts's "no /catalog/* route — catalog is private"
// comment as the authority here: seventeen lines below it the same file
// registers `/catalog/public/anime-overview/:bangumiId`. The reachability
// story is what this file asserts, not what any comment claims.
//
// Parsing here is deliberately line-based rather than via a TOML library: the
// point is to assert on the file a human edits, and adding a parser dependency
// to guard three lines is a worse trade than a strict reader that fails loudly
// on anything it does not understand.

interface Section {
  name: string;
  lines: string[];
}

// A sub-table ([env.staging.vars], [[env.staging.r2_buckets]]) ends the
// environment's own key list; keys after it belong to the sub-table.
const nameOf = (line: string, current: string): string | null => {
  const header = /^\[(env\.[A-Za-z0-9_-]+)\]$/.exec(line);
  if (header?.[1]) return header[1];
  return line.startsWith("[") ? `${current}:subtable` : null;
};

const sections = (toml: string): Section[] => {
  let current: Section = { name: "top-level", lines: [] };
  const out: Section[] = [current];
  for (const line of contentLines(toml)) {
    const opened = nameOf(line, current.name);
    if (opened === null) current.lines.push(line);
    else out.push((current = { name: opened, lines: [] }));
  }
  return out;
};

const contentLines = (toml: string): string[] =>
  toml.split("\n").map((raw) => raw.trim()).filter((line) => !line.startsWith("#"));

const environments = (toml: string): Section[] =>
  sections(toml).filter((s) => s.name === "top-level" || /^env\.[A-Za-z0-9_-]+$/.test(s.name));

// Both keys are `inheritable` in wrangler (4.112 cli.js:35080 / :35088), so the
// top-level value alone would suffice. Asserting per environment anyway is the
// policy: a reader deciding whether an environment is private should not have
// to know wrangler's inheritance rules to answer it.
//
// There is no exception: every declared deployment environment is private.
const PRIVACY: Record<string, string[]> = {
  "top-level": ["workers_dev = false", "preview_urls = false"],
  "env.staging": ["workers_dev = false", "preview_urls = false"],
  "env.production": ["workers_dev = false", "preview_urls = false"],
};

describe("catalog has no public host", () => {
  it("declares no routes, so workers_dev cannot be left to its default", () => {
    expect(toml).not.toMatch(/^\s*routes\s*=/m);
  });

  // Per-environment schedules (issue #1016, spec §183): production alone
  // declares the three ingest crons; staging declares ONLY the daily import
  // cron; development (top-level) declares none. Keep in sync with the
  // SEED_CRON / DAILY_DISCOVER_CRON / TTL_REFRESH_CRON / DAILY_IMPORT_CRON
  // strings in src/cron-config.ts.
  it("declares the three ingest schedules for production only", () => {
    expect(toml.split('crons = ["0 4 * * *", "0 6 * * *", "17 * * * *"]')).toHaveLength(2);
  });

  it("declares only the daily import cron for staging", () => {
    const staging = toml.split('crons = ["0 3 * * *"]');
    expect(staging).toHaveLength(2);
    expect(toml.split('["0 4 * * *", "0 6 * * *", "17 * * * *"]')).toHaveLength(2);
  });

  it("declares no crons for the development environment", () => {
    expect(toml.split('crons = []')).toHaveLength(2);
  });

  it("wires staging's daily import to a private read-only binding (AC2)", () => {
    expect(toml).toContain('[[env.staging.services]]');
    expect(toml).toContain('binding = "PROD_SNAPSHOT"');
    expect(toml).toContain('service = "catalog"');
  });

  it.each(Object.entries(PRIVACY))("%s declares %s", (name, expected) => {
    const section = environments(toml).find((s) => s.name === name);
    expect(section?.lines).toEqual(expect.arrayContaining(expected));
  });

  it("finds exactly the environments the file declares", () => {
    // Guards the parser and the table together: a new [env.X] that nobody adds
    // to PRIVACY fails here rather than being silently skipped by it.each.
    expect(environments(toml).map((s) => s.name)).toEqual(Object.keys(PRIVACY));
  });
});
