import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isBypassTurn,
  sameIds,
  selectedPointsBody,
} from "../../../src/lib/chat/selectedPointsBypass";

describe("selectedPointsBody (AC: the tray action can never fire empty)", () => {
  it("returns undefined for an empty selection", () => {
    expect(selectedPointsBody([])).toBeUndefined();
  });

  it("wraps a non-empty selection as the bypass body field", () => {
    expect(selectedPointsBody(["a", "b"])).toEqual({ selected_point_ids: ["a", "b"] });
  });

  it("copies the ids so later selection changes cannot mutate an in-flight body", () => {
    const ids = ["a"];
    const body = selectedPointsBody(ids);
    ids.push("b");
    expect(body?.selected_point_ids).toEqual(["a"]);
  });
});

describe("sameIds", () => {
  it("matches a set against the id list regardless of order", () => {
    expect(sameIds(new Set(["b", "a"]), ["a", "b"])).toBe(true);
  });

  it("rejects a size mismatch", () => {
    expect(sameIds(new Set(["a"]), ["a", "b"])).toBe(false);
  });

  it("rejects a same-size membership mismatch", () => {
    expect(sameIds(new Set(["a", "c"]), ["a", "b"])).toBe(false);
  });

  it("treats an undefined baseline as never matching", () => {
    expect(sameIds(new Set(["a"]), undefined)).toBe(false);
  });
});

describe("isBypassTurn (bypass turns suppress their plan_selected step part)", () => {
  const data = (intent: unknown) => ({ type: "data-response", data: { intent } });
  const tool = (type: string) => ({ type });

  it("detects the real bypass wire shape: plan_selected card + plan_selected step part", () => {
    expect(isBypassTurn([tool("tool-plan_selected"), data("plan_selected")])).toBe(true);
  });

  it("still detects a bypass card whose step part has not streamed yet", () => {
    expect(isBypassTurn([data("plan_selected")])).toBe(true);
  });

  it("ignores agent-path route intents", () => {
    expect(isBypassTurn([tool("tool-plan_route"), data("plan_route"), { type: "text" }])).toBe(false);
  });

  it("keeps badges for an agent-path plan_selected turn that ran other tools", () => {
    expect(isBypassTurn([tool("tool-resolve_anime"), tool("tool-plan_selected"), data("plan_selected")])).toBe(false);
  });

  it("ignores malformed data parts", () => {
    expect(isBypassTurn([data(undefined), { type: "data-response", data: null }])).toBe(false);
  });
});

function sourceFiles(dir: string): readonly string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/u.test(name) ? [path] : [];
  });
}

describe("AC: no second supersession implementation exists under apps/web/src", () => {
  const src = join(process.cwd(), "src");

  it("defines supersededFlags exactly once, in lib/chat/supersession.ts", () => {
    const defining = sourceFiles(src).filter((path) =>
      /function supersededFlags|supersededFlags\s*=/u.test(readFileSync(path, "utf8")),
    );
    expect(defining).toEqual([join(src, "lib", "chat", "supersession.ts")]);
  });

  it("keeps the one composed superseded-class producer in DataPartCard", () => {
    // The composed class string is the assembly site; bare references to the
    // class name (styles, selectors) in future files must not trip this.
    const producers = sourceFiles(src).filter((path) =>
      readFileSync(path, "utf8").includes("chat-card chat-card--superseded"),
    );
    expect(producers).toEqual([join(src, "features", "chat", "components", "DataPartCard.tsx")]);
  });
});
