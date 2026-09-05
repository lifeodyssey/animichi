import { describe, expect, it } from "vitest";
import { stringParam } from "../../../src/lib/search-params";

describe("stringParam", () => {
  it("keeps a value that carries something", () => {
    expect(stringParam("sess-1337")).toBe("sess-1337");
  });

  it("treats a whitespace-only param as absent, so `/chat?session=%20` resumes nothing", () => {
    expect(stringParam(" ")).toBeUndefined();
    expect(stringParam("\t")).toBeUndefined();
    expect(stringParam("\n  ")).toBeUndefined();
    expect(stringParam("")).toBeUndefined();
  });

  it("hands back the trimmed value, so a padded id still addresses one conversation", () => {
    expect(stringParam("  sess-1337  ")).toBe("sess-1337");
    expect(stringParam("\tsess-1337\n")).toBe("sess-1337");
  });

  it("rejects anything that is not a string", () => {
    expect(stringParam(undefined)).toBeUndefined();
    expect(stringParam(null)).toBeUndefined();
    expect(stringParam(7)).toBeUndefined();
    expect(stringParam(["sess-1337"])).toBeUndefined();
  });
});
