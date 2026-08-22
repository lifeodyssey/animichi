export type TokenMap = Readonly<Record<string, string>>;

export interface TokenMismatch {
  readonly actual: string;
  readonly expected: string;
  readonly semantic: string;
}

export interface FontFace {
  readonly family: string;
  readonly weight: number;
  readonly src: string;
  readonly unicodeRange: string | null;
}

export function parseBlockTokens(css: string, selector: string): TokenMap {
  const escaped = selector.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
  const body = new RegExp(`${escaped}[^{]*\\{([^}]*)\\}`, "u").exec(css)?.[1];
  if (body === undefined) throw new Error(`Missing block: ${selector}`);
  const tokens: Record<string, string> = {};
  const declarations = body.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/gu);
  for (const declaration of declarations) {
    const [, name, value] = declaration;
    if (name !== undefined && value !== undefined) tokens[name] = value.trim();
  }
  return tokens;
}

export function parseTokens(css: string): TokenMap {
  return parseBlockTokens(css, ":root");
}

/* The lookbehind is what stops `border` from reading back `--color-border`'s
 * value: a block that declares its own tokens alongside its properties (the
 * しおり card's frozen export palette does) otherwise answers every property
 * lookup whose name is the tail of a token name. */
function declarationValue(body: string, property: string): string | null {
  return new RegExp(String.raw`(?<![-\w])${property}\s*:\s*([^;]+)`, "u").exec(body)?.[1]?.trim() ?? null;
}

/**
 * The body of an at-rule block — `@layer base`, `@keyframes card-pop`. Absence
 * is a failure naming the block, not an empty string that silently passes
 * every `toContain` a test then makes of it.
 */
export function atRuleBody(css: string, prelude: string): string {
  const escaped = prelude.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
  const body = new RegExp(`${escaped}\\s*\\{([\\S\\s]*?)\\n\\}`, "u").exec(css)?.[1];
  if (body === undefined) throw new Error(`Missing at-rule: ${prelude}`);
  return body;
}

export function ruleDeclaration(css: string, selector: string, property: string): string | null {
  const escaped = selector.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
  const body = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "u").exec(css)?.[1];
  if (body === undefined) throw new Error(`Missing rule: ${selector}`);
  return declarationValue(body, property);
}

/**
 * The LAST rule whose selector list ends with `selector` — i.e. the cascade
 * winner when a block first joins a shared group and then overrides part of it.
 * `ruleDeclaration` would return the shared group's value instead.
 */
export function lastRuleDeclaration(css: string, selector: string, property: string): string | null {
  const escaped = selector.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
  const rules = [...css.matchAll(new RegExp(`(?:^|[\\n,])${escaped}\\s*\\{([^}]*)\\}`, "gu"))];
  const body = rules.at(-1)?.[1];
  if (body === undefined) throw new Error(`Missing rule: ${selector}`);
  return declarationValue(body, property);
}

/** Every leaf rule in a stylesheet, as `[selector list, body]`, comments gone. */
function leafRules(css: string): readonly (readonly [string, string])[] {
  const bare = css.replaceAll(/\/\*[\S\s]*?\*\//gu, "");
  return [...bare.matchAll(/([^{}]*)\{([^{}]*)\}/gu)]
    .map((rule) => [rule[1] ?? "", rule[2] ?? ""] as const);
}

/**
 * The declaration a selector gets from the last rule whose selector LIST names
 * it. `ruleDeclaration` anchors on `selector {`, so it cannot see a shared
 * plane like `card-plane.css`'s one rule for four card families; this can.
 * Concatenate the shared sheet BEFORE the skin's own, so the skin's unlayered
 * overrides stay the last word, exactly as the cascade has them. Rules that do
 * not mention the property are passed over rather than counted as a null, the
 * way a media-query override of one property leaves the others standing.
 */
export function sharedRuleDeclaration(css: string, selector: string, property: string): string | null {
  const bodies = leafRules(css)
    .filter(([list]) => list.split(",").some((one) => one.trim() === selector))
    .map(([, body]) => body);
  if (bodies.length === 0) throw new Error(`Missing rule: ${selector}`);
  const declaring = [...bodies].reverse().find((body) => declarationValue(body, property) !== null);
  return declaring === undefined ? null : declarationValue(declaring, property);
}

function requiredDeclaration(body: string, property: string): string {
  const value = declarationValue(body, property);
  if (value === null) throw new Error(`Missing font-face declaration: ${property}`);
  return value;
}

export function parseFontFaces(css: string): FontFace[] {
  return [...css.matchAll(/@font-face\s*\{([^}]*)\}/gu)].map((match) => {
    const body = match[1];
    if (body === undefined) throw new Error("Missing font-face body");
    const family = requiredDeclaration(body, "font-family").replaceAll(/["']/gu, "");
    const weight = Number(requiredDeclaration(body, "font-weight"));
    const src = requiredDeclaration(body, "src");
    const unicodeRange = declarationValue(body, "unicode-range");
    return { family, weight, src, unicodeRange };
  });
}

function rangeBounds(part: string): readonly [number, number] | null {
  const match = /^U\+([\dA-F]+)(?:-([\dA-F]+))?$/iu.exec(part.trim());
  const startText = match?.[1];
  if (startText === undefined) return null;
  const start = Number.parseInt(startText, 16);
  const end = match?.[2] === undefined ? start : Number.parseInt(match[2], 16);
  return [start, end];
}

export function rangeCoversCodepoint(
  unicodeRange: string | null,
  codepoint: number,
): boolean {
  if (unicodeRange === null) return true;
  return unicodeRange.split(",").some((part) => {
    const bounds = rangeBounds(part);
    return bounds !== null && codepoint >= bounds[0] && codepoint <= bounds[1];
  });
}

export function srcForCodepoint(
  faces: readonly FontFace[],
  family: string,
  weight: number,
  codepoint: number,
): string {
  const face = [...faces].reverse().find((candidate) =>
    candidate.family === family &&
    candidate.weight === weight &&
    rangeCoversCodepoint(candidate.unicodeRange, codepoint));
  if (face === undefined) {
    throw new Error(`Missing matching font face: ${family} ${String(weight)}`);
  }
  return face.src;
}

export function tokenValue(tokens: TokenMap, name: string): string {
  const value = tokens[name];
  if (value === undefined || value === "") throw new Error(`Missing token: ${name}`);
  return value;
}

export function normalizeHex(value: string): string {
  const hex = value.toLowerCase();
  if (!/^#[\da-f]{3}$/u.test(hex)) return hex;
  return hex.replace(/[\da-f]/gu, "$&$&");
}

export function alignmentMismatches(
  semanticTokens: TokenMap,
  animalTokens: TokenMap,
  alignment: TokenMap,
): TokenMismatch[] {
  return Object.entries(alignment).flatMap(([semantic, primitive]) => {
    const actual = normalizeHex(tokenValue(semanticTokens, semantic));
    const expected = normalizeHex(tokenValue(animalTokens, primitive));
    return actual === expected ? [] : [{ actual, expected, semantic }];
  });
}

function linearChannel(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const normalized = normalizeHex(hex).slice(1);
  const channels = normalized.match(/.{2}/gu)?.map((part) => Number.parseInt(part, 16));
  if (channels?.length !== 3) throw new Error(`Invalid hex color: ${hex}`);
  const [red = 0, green = 0, blue = 0] = channels.map(linearChannel);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

export function contrastRatio(first: string, second: string): number {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second));
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

function channelAt(from: string, to: string, index: number, position: number): number {
  const pair = [from, to].map((hex) => Number.parseInt(normalizeHex(hex).slice(1 + index * 2, 3 + index * 2), 16));
  const [start = 0, end = 0] = pair;
  return Math.round(start + (end - start) * position);
}

/** The colour a two-stop sRGB gradient shows at `position` (0 = from, 1 = to). */
export function gradientStop(from: string, to: string, position: number): string {
  const channels = [0, 1, 2].map((index) => channelAt(from, to, index, position));
  return `#${channels.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

/** The token names a declaration spends, in the order it spends them. */
export function referencedTokens(declaration: string): readonly string[] {
  return [...declaration.matchAll(/var\((--[\w-]+)\)/gu)].map((match) => match[1] ?? "");
}

/** Which of the two palettes globals.css ships a stylesheet is read under. */
export type Theme = "day" | "night";

/** WCAG 1.4.3 AA for body-size text. */
export const AA_CONTRAST = 4.5;

/** `color` / `background`, never `border-color` — the parser interpolates raw. */
export const TEXT_COLOR = String.raw`(?<![-\w])color`;
export const GROUND_COLOR = String.raw`(?<![-\w])background`;

export type DeclarationReader = (css: string, selector: string, property: string) => string | null;

export interface SkinContrastSpec {
  /** The stylesheet whose rules are being read back. */
  readonly sheet: string;
  /** Every token in scope by day — globals `:root` plus any skin-local block. */
  readonly day: TokenMap;
  /** Only the tokens `[data-theme="night"]` overrides. */
  readonly night: TokenMap;
  /** Defaults to `ruleDeclaration`; pass `lastRuleDeclaration` where the cascade decides. */
  readonly declarationOf?: DeclarationReader;
}

/** One skin's stylesheet, read the way the browser would compute its colours. */
export class SkinContrast {
  readonly #spec: SkinContrastSpec;
  readonly #declarationOf: DeclarationReader;

  constructor(spec: SkinContrastSpec) {
    this.#spec = spec;
    this.#declarationOf = spec.declarationOf ?? ruleDeclaration;
  }

  palette(theme: Theme): TokenMap {
    return theme === "night" ? { ...this.#spec.day, ...this.#spec.night } : this.#spec.day;
  }

  /** Follow a declared value through its `var(--…)` chain down to a literal colour. */
  resolve(value: string, theme: Theme): string {
    const target = /var\((--[\w-]+)\)/u.exec(value)?.[1];
    if (target === undefined) return value;
    return this.resolve(tokenValue(this.palette(theme), target), theme);
  }

  /** The colour a rule really paints. */
  paint(selector: string, property: string, theme: Theme): string {
    const declared = this.#declarationOf(this.#spec.sheet, selector, property);
    if (declared === null) throw new Error(`${selector} declares no ${property}`);
    return this.resolve(declared, theme);
  }

  readability(selector: string, ground: string, theme: Theme): number {
    return contrastRatio(this.paint(selector, TEXT_COLOR, theme), this.paint(ground, GROUND_COLOR, theme));
  }
}
