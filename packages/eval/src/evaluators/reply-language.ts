/**
 * Current-turn reply-language policy — the port of
 * `apps/agent/src/animichi/utils/language.py`, which decides `LocaleMatch`.
 *
 * Runtime and evals share the same policy in Python; this file is the eval
 * side's copy. Iteration is by code point (`for…of`), not by UTF-16 unit, so
 * the supplementary Han range 0x20000–0x2FA1F counts once per character the way
 * Python's `ord()` does.
 */

type CodePointRange = readonly [number, number];

const HAN_RANGES: readonly CodePointRange[] = [
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xf900, 0xfaff],
  [0x20000, 0x2fa1f],
];

const KANA_RANGES: readonly CodePointRange[] = [
  [0x3040, 0x30ff],
  [0x31f0, 0x31ff],
  [0xff66, 0xff9d],
];

/**
 * The three languages a reply may be judged in. The *fallback* stays a bare
 * `string` because it comes from the dataset's `locale` field, which is not
 * constrained to these — narrowing it is exactly what the two guards below do.
 */
export type ReplyLanguage = 'en' | 'ja' | 'zh';

const SIMPLIFIED_HINTS = new Set('为么这请绍仪动欢凉宫间过发见处门车边还让圣');
const REPLY_LANGUAGES = new Set<string>(['en', 'ja', 'zh']);
/** Han without kana keeps a CJK fallback; anything else lands on Chinese. */
const HAN_FALLBACKS = new Set<string>(['ja', 'zh']);

function asReplyLanguage(fallback: string, whenUnknown: ReplyLanguage): ReplyLanguage {
  return REPLY_LANGUAGES.has(fallback) ? (fallback as ReplyLanguage) : whenUnknown;
}
const LATIN_SUPPLEMENT: CodePointRange = [0x00c0, 0x024f];
const ASCII_LETTER = /^[A-Za-z]$/;

interface ScriptCounts {
  readonly han: number;
  readonly kana: number;
  readonly latin: number;
}

function inRanges(point: number, ranges: readonly CodePointRange[]): boolean {
  return ranges.some(([start, end]) => start <= point && point <= end);
}

function isLatin(char: string, point: number): boolean {
  const [start, end] = LATIN_SUPPLEMENT;
  return ASCII_LETTER.test(char) || (start <= point && point <= end);
}

function scriptCounts(text: string): ScriptCounts {
  let han = 0;
  let kana = 0;
  let latin = 0;
  for (const char of text) {
    const point = char.codePointAt(0) ?? 0;
    han += inRanges(point, HAN_RANGES) ? 1 : 0;
    kana += inRanges(point, KANA_RANGES) ? 1 : 0;
    latin += isLatin(char, point) ? 1 : 0;
  }
  return { han, kana, latin };
}

/** Detect ja/zh/en from Unicode scripts, defaulting unknown text to English. */
export function detectLanguage(text: string): ReplyLanguage {
  const { han, kana, latin } = scriptCounts(text);
  if (kana > 0 && kana + han >= latin) {
    return 'ja';
  }
  return han > 0 && han >= latin ? 'zh' : 'en';
}

/** Prefer meaningful current-turn script evidence over the runtime fallback. */
export function resolveReplyLanguage(text: string, fallback: string): ReplyLanguage {
  const { han, kana, latin } = scriptCounts(text);
  if (han > 0 && hasSimplifiedHint(text)) {
    return 'zh';
  }
  if (kana > 0 || latin >= 2) {
    return detectLanguage(text);
  }
  if (han > 0) {
    return HAN_FALLBACKS.has(fallback) ? asReplyLanguage(fallback, 'zh') : 'zh';
  }
  return asReplyLanguage(fallback, 'ja');
}

function hasSimplifiedHint(text: string): boolean {
  for (const char of text) {
    if (SIMPLIFIED_HINTS.has(char)) {
      return true;
    }
  }
  return false;
}
