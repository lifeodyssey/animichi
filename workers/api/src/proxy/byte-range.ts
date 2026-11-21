/**
 * One `Range` request header value, as the R2 asset proxies read it
 * (`proxy/tiles.ts`, `proxy/docs-assets.ts`).
 *
 * The three answers are three KINDS rather than a `T | null | undefined`,
 * because a caller must never confuse them: `whole` is the whole object,
 * `unsatisfiable` is a 416, and `slice` is the range to hand R2. A tri-state
 * union leaves that up to the reader — this was the tile arm's own parsing
 * before #1650, and two arms reading one header grammar is exactly when an
 * unnamed third state turns into a silently wrong gate. The tile arm's tests
 * still cover the grammar through `/tiles/*`.
 */

/** The slice forms R2's `get({ range })` accepts. */
export type ByteRange =
  | Readonly<{ offset: number; length?: number }>
  | Readonly<{ offset?: number; length: number }>
  | Readonly<{ suffix: number }>;

/** What one `Range` header asked for: no header is the whole object, a header
 * naming a slice is that slice, and a header naming no possible slice is the
 * 416 the arm answers with. */
export type RangeDecision =
  | Readonly<{ kind: "whole" }>
  | Readonly<{ kind: "unsatisfiable" }>
  | Readonly<{ kind: "slice"; range: ByteRange }>;

const RANGE_PATTERN = /^bytes=(\d+)-(\d*)$/;
const SUFFIX_RANGE_PATTERN = /^bytes=-(\d+)$/;
const WHOLE: RangeDecision = { kind: "whole" };
const UNSATISFIABLE: RangeDecision = { kind: "unsatisfiable" };

function parseFirstRange(value: string): ByteRange | undefined {
  const range = RANGE_PATTERN.exec(value);
  if (!range) return undefined;
  const offset = Number(range[1]);
  const end = range[2] === "" ? undefined : Number(range[2]);
  if (end !== undefined && end < offset) return undefined;
  return { offset, ...(end === undefined ? {} : { length: end - offset + 1 }) };
}

function parseSuffixRange(value: string): ByteRange | undefined {
  const suffix = SUFFIX_RANGE_PATTERN.exec(value);
  if (suffix && Number(suffix[1]) > 0) return { suffix: Number(suffix[1]) };
  return undefined;
}

/** No header reads the whole object; a header naming no slice is refused. */
export function parseByteRange(value: string | null): RangeDecision {
  if (value === null) return WHOLE;
  const range = parseFirstRange(value) ?? parseSuffixRange(value);
  return range === undefined ? UNSATISFIABLE : { kind: "slice", range };
}
