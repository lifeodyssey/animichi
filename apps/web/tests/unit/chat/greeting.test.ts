import { describe, expect, it } from "vitest";
import { LOCALES } from "../../../src/i18n/locales";
import { greetingRuns } from "../../../src/features/chat/greeting";
import { chatDictFor } from "../../../src/features/chat/i18n";

describe("greetingRuns", () => {
  it("cuts the text at a marked phrase and keeps both sides", () => {
    expect(greetingRuns("hello brave world", ["brave"])).toEqual([
      { text: "hello ", emphasised: false },
      { text: "brave", emphasised: true },
      { text: " world", emphasised: false },
    ]);
  });

  it("marks each phrase in the order the dictionary lists them", () => {
    const runs = greetingRuns("a B c D", ["B", "D"]);
    expect(runs.filter((run) => run.emphasised).map((run) => run.text)).toEqual(["B", "D"]);
    expect(runs.map((run) => run.text).join("")).toBe("a B c D");
  });

  it("emits no empty run when a phrase opens or closes the text", () => {
    expect(greetingRuns("BC", ["B", "C"]).map((run) => run.text)).toEqual(["B", "C"]);
  });

  it("marks a repeated phrase as often as the dictionary lists it, no more", () => {
    expect(greetingRuns("B and B", ["B"]).filter((run) => run.emphasised)).toHaveLength(1);
    expect(greetingRuns("B and B", ["B", "B"]).filter((run) => run.emphasised)).toHaveLength(2);
  });

  it("skips a phrase that is not there and still marks the ones that are", () => {
    const runs = greetingRuns("x B", ["missing", "B"]);
    expect(runs.filter((run) => run.emphasised).map((run) => run.text)).toEqual(["B"]);
  });

  it("leaves the text whole when a phrase is absent, so copy edits cannot crash it", () => {
    expect(greetingRuns("plain", ["missing"])).toEqual([{ text: "plain", emphasised: false }]);
    expect(greetingRuns("plain", [])).toEqual([{ text: "plain", emphasised: false }]);
  });
});

describe("the lead bubble's copy in every locale", () => {
  it.each(LOCALES)("%s marks phrases that really occur in its greeting", (locale) => {
    const dict = chatDictFor(locale);
    expect(dict.greetingEmphasis.length).toBeGreaterThan(1);
    for (const phrase of dict.greetingEmphasis) expect(dict.greeting).toContain(phrase);
  });

  it.each(LOCALES)("%s reassembles to exactly the greeting it was cut from", (locale) => {
    const dict = chatDictFor(locale);
    const runs = greetingRuns(dict.greeting, dict.greetingEmphasis);
    expect(runs.map((run) => run.text).join("")).toBe(dict.greeting);
    expect(runs.filter((run) => run.emphasised)).toHaveLength(dict.greetingEmphasis.length);
  });

  it.each(LOCALES)("%s names what the fox accepts, which the old one-liner did not", (locale) => {
    const dict = chatDictFor(locale);
    expect(dict.greeting.length).toBeGreaterThan(40);
    expect(dict.greetingEmphasis[1]?.length ?? 0).toBeGreaterThan(8);
  });
});
