import type { PageResult } from "./web-result-page.ts";

const NAME = "untrusted_web_result";
const OPENINGS = ["<", "</", "< /", "<\\/", "<\u{0}/", "</\u{200b}", "<\u{feff}", "<<"];
const CLOSINGS = [">", " >", "\u{0}>", "\u{200b}>", "/>", ""];
/** Usually nothing; otherwise whitespace, a control, a separator or a format character. */
const INTERLEAVED = [...Array.from({ length: 12 }, () => ""), " ", "\t", "\n", "\u{0}", "\u{1f}", "\u{7f}", "\u{80}", "\u{85}", "\u{a0}", "\u{ad}", "\u{200b}", "\u{200d}", "\u{2028}", "\u{2060}", "\u{3000}", "\u{feff}"];
const SURROUNDING = ["", "聖地巡礼ガイド ", "a < b ", "Tom & Jerry ", "<b>", "&#60;", "&lt;/", "…", "result>"];
const SHAPES = [variant, nested, (random: () => number) => nested(random) + variant(random)];

/** mulberry32: one seed gives the same sequence on every run and runtime. */
export function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    const mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    const spread = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((spread ^ (spread >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(values: readonly string[], random: () => number): string {
  return values[Math.floor(random() * values.length)] ?? "";
}

/** A wrapper tag in a random letter case, with unseen characters between its letters and brackets. */
function variant(random: () => number): string {
  const name = Array.from(NAME, (letter) => pick([letter, letter.toUpperCase()], random) + pick(INTERLEAVED, random)).join("");
  return pick(OPENINGS, random) + name + pick(CLOSINGS, random);
}

/** One variant placed inside another. */
function nested(random: () => number): string {
  const outer = variant(random), at = Math.floor(random() * (outer.length + 1));
  return outer.slice(0, at) + variant(random) + outer.slice(at);
}

function fieldText(random: () => number): string {
  const shape = SHAPES[Math.floor(random() * SHAPES.length)] ?? variant;
  return pick(SURROUNDING, random) + shape(random) + pick(SURROUNDING, random);
}

/** A page of five results whose titles and snippets all carry generated delimiter variants. */
export function delimiterVariantPage(random: () => number): PageResult[] {
  return Array.from({ length: 5 }, () => ({ title: fieldText(random), snippet: fieldText(random) }));
}
