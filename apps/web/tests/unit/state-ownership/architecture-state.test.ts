/**
 * AC3/AC4/AC6 state-ownership rules for `apps/web/src` (issue #1009):
 * URL-owned chat state has no second durable authority (AC3), query results
 * are never copied into local state (AC4), and one fact never spans ≥2
 * ownership channels (AC6). The reviewer fixtures are parsed source, never
 * executed.
 *
 * The suite pins a deterministic fixed clock (issue #1009 review) so nothing
 * here ever depends on wall-clock time.
 */

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { duplicateFactViolations, localCopyViolations } from "./checker";
import { channelBindings, duplicateFactChannels, localCopyViolationsInSource } from "./channels";
import { srcRoot, walkSourceFiles, withoutComments } from "./scan";

const SRC = srcRoot();
const FIXTURES = `${SRC}/../tests/unit/state-ownership/fixtures`;
const FIXED_NOW = 1_750_000_000_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

function fixtureSource(name: string): string {
  return readFileSync(`${FIXTURES}/${name}`, "utf8");
}

describe("AC3: URL-owned chat state has no second durable authority", () => {
  it("the chat search facts (?q=, ?session=, ?settings=byok, ?route=) exist only in the URL parser", () => {
    const storageUsers = walkSourceFiles(SRC).filter((file) => {
      const source = withoutComments(readFileSync(`${SRC}/${file}`, "utf8"));
      return source.includes("sessionStorage") || source.includes("localStorage");
    });
    const chatStorage = storageUsers.filter((file) => file.includes("chat"));
    expect(chatStorage).toEqual([
      "features/chat/lib/draft-storage.ts",
      "features/chat/save/deferred-save.ts",
    ]);
  });
});

describe("AC4: query results are never copied into local state", () => {
  it("finds no useState/useReducer seeded from a URL/Query/Context value anywhere in src/", () => {
    expect(localCopyViolations(SRC)).toEqual([]);
  });

  it("computed derivation stays on the query hook (use-continue-from)", () => {
    const source = readFileSync(`${SRC}/api/hooks/use-continue-from.ts`, "utf8");
    expect(source).toMatch(/pickContinueFrom\(query\.data\.saved_routes\)/);
    expect(source).not.toMatch(/useState/);
  });

  it("the BYOK panel derives open from the URL and writes it back (use-byok-panel)", () => {
    const source = readFileSync(`${SRC}/features/chat/use-byok-panel.ts`, "utf8");
    expect(source).toMatch(/open\s*=\s*search\.settings\s*===\s*"byok"/);
    expect(source).toMatch(/router\.navigate/);
    expect(source).not.toMatch(/useState|useReducer/);
  });
});

describe("AC6: the reviewer fixture trips the duplicate-ownership detector", () => {
  const source = fixtureSource("duplicate-ownership.tsx");

  it("the fixture binds one fact on all four channels", () => {
    const bindings = channelBindings(source);
    expect(bindings.url).toContain("url");
    expect(bindings.query).toContain("query");
    expect(bindings.context).toContain("context");
    expect(bindings.local).toContain("localQ");
  });

  it("detects the fact 'q' in URL, Query cache, Context and local state", () => {
    const byFact = duplicateFactChannels(source);
    expect(byFact.get("q")).toEqual(["context", "local", "query", "url"]);
    const copies = localCopyViolationsInSource(source);
    expect(copies).toContain("local state seeded from q (a URL/Query/Context value)");
  });

  it("the whole-tree scan stays clean while the fixture is the only offender (fixtures are not src/)", () => {
    expect(duplicateFactViolations(SRC)).toEqual([]);
  });

  it("the fixture is never executed by the gate — it is parsed source (tsc + oxlint cover its type safety)", () => {
    expect(source).toContain('import { useQuery } from "@tanstack/react-query"');
    expect(source).toContain('import { useSearch } from "@tanstack/react-router"');
    expect(source).toContain("export function useDuplicateOwnershipFixture");
    expect(source).not.toMatch(/vitest|it\(|expect\(/u);
  });
});

describe("AC6 regression: imported hook aliases + object destructuring are detected", () => {
  const source = fixtureSource("alias-hooks.tsx");

  it("binds object-destructured hook results with aliases resolved", () => {
    const bindings = channelBindings(source);
    expect(bindings.url).toContain("q");
    expect(bindings.query).toContain("queryQ");
  });

  it("binds imported hook aliases and preserves the direct + array forms", () => {
    const bindings = channelBindings(source);
    expect(bindings.url).toContain("url");
    expect(bindings.query).toContain("queryQ");
    expect(bindings.local).toContain("localQ");
  });

  it("the aliased fact 'q' is still detected on every ownership channel", () => {
    const byFact = duplicateFactChannels(source);
    expect(byFact.get("q")).toEqual(["context", "local", "query", "url"]);
  });

  it("the alias fixture is never executed by the gate either", () => {
    expect(source).toContain('import { useQuery as useServerQuery } from "@tanstack/react-query"');
    expect(source).toContain("export function useAliasedHooksFixture");
    expect(source).not.toMatch(/vitest|it\(|expect\(/u);
  });
});
