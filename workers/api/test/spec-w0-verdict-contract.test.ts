import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL, fileURLToPath } from "node:url";

// #1249 (W0-KS) — the kill-switch verdict is a document, so the document is the
// artifact under test. §四 states the five spike gates; a gate whose 结论 line is
// missing means W1 started on an unrecorded verdict, which the Kill-switch
// paragraph itself forbids ("spike 结论与复测数据必须回填本 spec 后才进 W1").
// Read verbatim so deleting a 结论 line, the 裁决 line, or an appendix that
// carries the measurements fails here instead of in a review.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SPEC = readFileSync(ROOT + "docs/specs/2026-09-01-agent-ts-rewrite-spec.md", "utf8");

const SECTION_FOUR_START = "\n## 四、";
const SECTION_FIVE_START = "\n## 五、";

// [gate, its bullet's opening marker, the marker that ends it]. S5 is closed by
// the Kill-switch paragraph, which is the rule the 裁决 below applies.
const GATE_BULLETS: readonly (readonly [string, string, string])[] = [
  ["S1", "- **S1**：", "- **S2**："],
  ["S2", "- **S2**：", "- **S3**："],
  ["S3", "- **S3**：", "- **S4**："],
  ["S4", "- **S4**：", "- **S5**："],
  ["S5", "- **S5**：", "**Kill-switch**"],
];

const APPENDICES: readonly [string, string][] = [
  ["A", "W0-S1"],
  ["B", "W0-S2"],
  ["C", "W0-S4"],
  ["D", "W0-S5"],
];

function sliceBetween(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end);
  assert.ok(from >= 0, "spec must contain " + JSON.stringify(start));
  assert.ok(to > from, JSON.stringify(start) + " must precede " + JSON.stringify(end));
  return source.slice(from, to);
}

const sectionFour = sliceBetween(SPEC, SECTION_FOUR_START, SECTION_FIVE_START);

for (const [gate, start, end] of GATE_BULLETS) {
  void test("§四 " + gate + " carries a backfilled 结论 line", () => {
    assert.match(
      sliceBetween(sectionFour, start, end),
      /\n {2}- 结论：/,
      gate + " must state its pass/fail conclusion with the measured numbers",
    );
  });
}

void test("§四 records the kill-switch 裁决 and names card #1249", () => {
  assert.match(
    sectionFour,
    /^\*\*裁决（[^）]*#1249）\*\*：/m,
    "the verdict paragraph must be attributed to the W0-KS card",
  );
});

for (const [letter, spike] of APPENDICES) {
  void test("附录 " + letter + " (" + spike + ") heading is present", () => {
    assert.match(
      SPEC,
      new RegExp("^## 附录 " + letter + " · " + spike + " 实测", "m"),
      "the 结论 lines cite 附录 " + letter + "; the measurements must stay in the spec",
    );
  });
}
