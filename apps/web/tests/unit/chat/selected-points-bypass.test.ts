import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  hasRecomputePart,
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

describe("hasRecomputePart (bypass turns render the footprint, not the pipeline)", () => {
  const part = (data: unknown) => ({ type: "data-response", data });

  it("detects a plan_selected data part on the message", () => {
    const message = { parts: [part({ intent: "plan_selected" })] };
    expect(hasRecomputePart(message.parts)).toBe(true);
  });

  it("ignores agent-path route intents", () => {
    const message = { parts: [part({ intent: "plan_route" }), { type: "text", text: "hi" }] };
    expect(hasRecomputePart(message.parts)).toBe(false);
  });

  it("ignores malformed data parts", () => {
    expect(hasRecomputePart([part(null), part({})])).toBe(false);
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

  it("keeps every superseded-class producer on the one shared helper", () => {
    const producers = sourceFiles(src).filter((path) =>
      readFileSync(path, "utf8").includes("chat-card--superseded"),
    );
    expect(producers).toEqual([join(src, "features", "chat", "components", "DataPartCard.tsx")]);
  });
});
