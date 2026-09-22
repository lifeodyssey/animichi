/**
 * AC3 (#1632): no hand-written row-shape narrowing remains; result types come
 * from the query builder.
 *
 * Two halves, because neither alone is the property.
 *
 * The BEHAVIOURAL half is the real one: the deleted helpers (`isRecord`,
 * `strings`, `requireSavedRouteRow`, `RecordRow`) existed because the executor
 * seam returned `{ rows: unknown[] }`, so every reader repaired whatever it
 * found — a non-array `point_ids` became `[]`, a non-string `title` became `""`.
 * A typed plan has nothing to repair, so a row the contract's columns could not
 * have produced now fails loudly instead of being quietly rewritten. That
 * difference is asserted below; it cannot be satisfied by a rename.
 *
 * The SOURCE half is the tripwire for the seam coming back. It is a scan of
 * `src/`, and a scan that matched nothing because it read nothing would report
 * the same green — so it asserts it read every module, and it runs the same
 * matcher over an injected violation to show the matcher can still fail.
 */
import { describe, expect, it } from "vitest";
import { NeonSavedRouteRepo, toSavedRoute } from "../src/adapters/neon-saved-route-repo";
import { fakeUsersPrisma } from "./fake-users-prisma";

/** The narrowing vocabulary, and the seam shape that made it necessary. */
const NARROWING = [
  { name: "the unknown-row executor seam", pattern: /rows:\s*unknown\[\]/u },
  { name: "a record re-derivation", pattern: /\bisRecord\s*\(/u },
  { name: "an array coercion helper", pattern: /\bstrings\s*\(/u },
  { name: "a required-row guard", pattern: /\brequireSavedRouteRow\b/u },
  { name: "a raw-record row type", pattern: /\bRecordRow\b/u },
] as const;

/**
 * Comments removed, string/template literals left intact — the same reader
 * `eddsa-shared-primitive.worker.test.ts` uses, and for the same reason: a doc
 * comment that *names* a deleted helper (this card's own notes do) must not read
 * as the helper being back.
 */
const LITERAL_OR_COMMENT =
  /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`|\/\/[^\n]*|\/\*[\s\S]*?\*\//g;

function stripComments(source: string): string {
  return source.replace(LITERAL_OR_COMMENT, (match) =>
    match.startsWith("//") || match.startsWith("/*") ? "" : match,
  );
}

/** Every narrowing idiom `source` still names, by label. */
function narrowingIn(source: string): string[] {
  const code = stripComments(source);
  return NARROWING.filter((entry) => entry.pattern.test(code)).map((entry) => entry.name);
}

/** Every TypeScript module under `src`, as raw text, keyed by path. */
function sources(): Record<string, string> {
  return import.meta.glob("../src/**/*.ts", { query: "?raw", import: "default", eager: true });
}

describe("AC3: a typed plan has nothing left to repair", () => {
  it("does not silently rewrite a row the contract's columns could not produce", async () => {
    const store = fakeUsersPrisma();
    // A row the old adapter would have returned as `point_ids: []`, `title: ""`.
    store.rows.push({
      id: "00000000-0000-4000-8000-0000000000cc", user_id: "user-a",
      title: null, point_ids: null, status: "saved", saved_at: null, updated_at: null,
    } as unknown as Parameters<typeof store.rows.push>[0]);

    const repo = new NeonSavedRouteRepo(store.prisma);
    await expect(repo.listOwned("user-a")).rejects.toThrow();
  });

  it("only maps what the public model needs, off a row it was handed", () => {
    // The mapper's parameter is the plan's own row type, so this is the one
    // place a shape could be re-derived — and there is none: every field is
    // read straight off the row.
    expect(toSavedRoute({
      id: "00000000-0000-4000-8000-0000000000cc", title: null, point_ids: ["p1"],
      status: "saved", saved_at: null, updated_at: "2026-07-13T04:00:00.000Z",
    })).toEqual({
      id: "00000000-0000-4000-8000-0000000000cc", title: "", point_ids: ["p1"],
      status: "saved", saved_at: null, updated_at: "2026-07-13T04:00:00.000Z",
    });
  });
});

describe("AC3: the unknown-row seam has not come back", () => {
  it("reads every module and finds no narrowing idiom in any of them", () => {
    const modules = sources();
    // A broken walk would report the same emptiness as a clean tree.
    expect(Object.keys(modules).length).toBeGreaterThan(5);
    for (const [path, text] of Object.entries(modules)) {
      expect(narrowingIn(text), `${path} names a hand-written row shape`).toEqual([]);
    }
  });

  it("still fails the check it runs when a narrowing idiom is present", () => {
    // The mutation arm: the matcher must be able to say no.
    expect(narrowingIn("const RecordRow = Record<string, unknown>;")).toEqual([
      "a raw-record row type",
    ]);
    expect(narrowingIn("function isRecord(value: unknown): value is RecordRow {}")).toContain(
      "a record re-derivation",
    );
    expect(narrowingIn("execute: (query) => Promise<{ rows: unknown[] }>")).toEqual([
      "the unknown-row executor seam",
    ]);
  });
});
