import { describe, expect, it } from "vitest";
import { DICTIONARIES, dictFor } from "../../src/i18n/dictionaries";
import { LOCALES } from "../../src/i18n/locales";

function keyPaths(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    keyPaths(child, prefix ? `${prefix}.${key}` : key),
  );
}

const jaPaths = keyPaths(DICTIONARIES.ja).sort();

describe("dictionaries", () => {
  it.each(LOCALES)("%s has the exact same key structure as ja", (locale) => {
    expect(keyPaths(DICTIONARIES[locale]).sort()).toEqual(jaPaths);
  });

  it.each(LOCALES)("%s has no empty strings", (locale) => {
    const values = keyPaths(DICTIONARIES[locale]).map((path) =>
      path.split(".").reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], DICTIONARIES[locale]),
    );
    expect(values.every((value) => typeof value === "string" && value.length > 0)).toBe(true);
  });

  it("dictFor resolves each locale", () => {
    expect(dictFor("en").landing.cta).toBe("Start Exploring");
    expect(dictFor("ja").landing.cta).not.toBe(dictFor("en").landing.cta);
  });
});
