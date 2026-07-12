export type TokenMap = Readonly<Record<string, string>>;

export interface TokenMismatch {
  readonly actual: string;
  readonly expected: string;
  readonly semantic: string;
}

export function parseTokens(css: string): TokenMap {
  const tokens: Record<string, string> = {};
  const declarations = css.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/gu);
  for (const declaration of declarations) {
    const [, name, value] = declaration;
    if (name !== undefined && value !== undefined) tokens[name] = value.trim();
  }
  return tokens;
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
