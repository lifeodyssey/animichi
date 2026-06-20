import { describe, expect, it } from "vitest";
import {
  normalizeAlias,
  rankAliases,
  Source,
  SOURCE_PRIORITY,
} from "../src/lib/alias";

/**
 * Unit tests for alias normalization + multi-source priority ranking
 * (catalog/src/lib/alias.ts), feeding the `aliases` catalog table.
 *
 * Expected NFKC outputs were captured from Node's String.prototype.normalize
 * ("NFKC") directly. Named *.worker.test.ts so the vitest-pool-workers config
 * picks it up; the logic is pure and runtime-agnostic.
 */

describe("normalizeAlias (NFKC fold)", () => {
  it("folds full-width ASCII to half-width and lowercases", () => {
    expect(normalizeAlias("ＦＡＴＥ")).toBe("fate");
  });

  it("folds the full-width ideographic space and collapses it", () => {
    expect(normalizeAlias("Ｆate　Ｓtay")).toBe("fate stay");
  });

  it("folds half-width katakana (with combining dakuten) to full-width", () => {
    // ｶﾞﾝﾀﾞﾑ (half-width + combining voiced marks) -> ガンダム
    expect(normalizeAlias("ｶﾞﾝﾀﾞﾑ")).toBe("ガンダム");
  });

  it("leaves already-canonical full-width katakana unchanged", () => {
    expect(normalizeAlias("ガンダム")).toBe("ガンダム");
  });

  it("folds circled-number compatibility chars", () => {
    expect(normalizeAlias("①②")).toBe("12");
  });
});

describe("normalizeAlias (whitespace + case)", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeAlias("  Re:Zero   ")).toBe("re:zero");
  });

  it("collapses runs of internal whitespace to a single space", () => {
    expect(normalizeAlias("A   B\t\nC")).toBe("a b c");
  });

  it("lowercases mixed-case ASCII", () => {
    expect(normalizeAlias("HyOuKa")).toBe("hyouka");
  });
});

describe("rankAliases (dedup by normalized form, highest source wins)", () => {
  it("keeps the higher-priority source when two sources share a normalized form", () => {
    const ranked = rankAliases([
      { alias: "響け！ユーフォニアム", source: Source.Moegirl },
      { alias: "響け！ユーフォニアム", source: Source.Bangumi },
    ]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]!.source).toBe(Source.Bangumi);
    expect(ranked[0]!.priority).toBe(SOURCE_PRIORITY[Source.Bangumi]);
  });

  it("dedups across full-width vs half-width variants of the same alias", () => {
    const ranked = rankAliases([
      { alias: "ＦＡＴＥ", source: Source.Moegirl },
      { alias: "fate", source: Source.AniDB },
    ]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]!.alias_normalized).toBe("fate");
    // AniDB (30) outranks Moegirl (20).
    expect(ranked[0]!.source).toBe(Source.AniDB);
  });

  it("preserves the original (un-normalized) alias string of the winner", () => {
    const ranked = rankAliases([
      { alias: "  Re:Zero  ", source: Source.Bangumi },
      { alias: "re:zero", source: Source.Moegirl },
    ]);
    expect(ranked[0]!.alias).toBe("  Re:Zero  ");
    expect(ranked[0]!.alias_normalized).toBe("re:zero");
  });

  it("keeps distinct normalized forms as separate rows", () => {
    const ranked = rankAliases([
      { alias: "Hyouka", source: Source.Bangumi },
      { alias: "氷菓", source: Source.Moegirl },
    ]);
    expect(ranked).toHaveLength(2);
  });

  it("drops aliases that normalize to empty", () => {
    expect(rankAliases([{ alias: "   ", source: Source.Bangumi }])).toEqual([]);
  });

  it("ranks the four sources Bangumi > AniDB > Moegirl > Manual", () => {
    expect(SOURCE_PRIORITY[Source.Bangumi]).toBeGreaterThan(
      SOURCE_PRIORITY[Source.AniDB],
    );
    expect(SOURCE_PRIORITY[Source.AniDB]).toBeGreaterThan(
      SOURCE_PRIORITY[Source.Moegirl],
    );
    expect(SOURCE_PRIORITY[Source.Moegirl]).toBeGreaterThan(
      SOURCE_PRIORITY[Source.Manual],
    );
  });
});
