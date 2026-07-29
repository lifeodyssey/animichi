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

function declarationValue(body: string, property: string): string | null {
  return new RegExp(`${property}\\s*:\\s*([^;]+)`, "u").exec(body)?.[1]?.trim() ?? null;
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
