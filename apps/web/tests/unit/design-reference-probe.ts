/**
 * Reads `docs/design/animal-island-ref/color-and-depth.md` as a set of claims
 * about our live tokens and checks each one against `globals.css`. The
 * reference's failure mode is a claim that reads as authoritative but names a
 * token that does not exist or pins the wrong value, so the probe fails closed
 * on every token name it sees, not just the ones under an "Ours" label.
 */
import { AA_CONTRAST, contrastRatio, normalizeHex, tokenValue, type TokenMap } from "./stylesheet-probe";

export interface TokenClaim {
  readonly token: string;
  readonly value: string;
}

export interface ContrastRow {
  readonly name: string;
  readonly value: string;
  readonly isToken: boolean;
  readonly ratios: readonly number[];
  readonly passes: readonly boolean[];
}

export interface DesignDoc {
  readonly path: string;
  readonly text: string;
}

export const AA_GROUNDS = ["--color-card", "--color-muted", "--color-paper"] as const;
/** `--token: #value` inside one backticked span, the shape every "Ours" claim uses. */
const TOKEN_CLAIM = /`(--[a-z][a-z0-9-]*):\s*(#[0-9a-fA-F]{3,8})`/gu;
/** A token name, never the `---` of a table separator (the letter is required). */
const TOKEN_NAME = /--[a-z][a-z0-9-]*/gu;
const HEX_CELL = /^`(#[0-9a-fA-F]{3,8})`$/u;
const RATIO_CELL = /^\d+\.\d{3}\s+(AA|fail)$/u;
const SUPERSEDED = /supersed|stale|archive|废弃|归档/iu;
const DIRECTORY = "docs/design/animal-island-ref";

function cellsOf(line: string): readonly string[] {
  return line.startsWith("|") ? line.split("|").slice(1, -1).map((cell) => cell.trim()) : [];
}

export function parseTokenClaims(doc: string): readonly TokenClaim[] {
  return [...doc.matchAll(TOKEN_CLAIM)].map((match) => ({
    token: match[1] ?? "",
    value: normalizeHex(match[2] ?? ""),
  }));
}

export function parseMentionedTokens(doc: string): readonly string[] {
  return [...new Set([...doc.matchAll(TOKEN_NAME)].map((match) => match[0]))];
}

export function claimViolations(doc: string, tokens: TokenMap): readonly string[] {
  return parseTokenClaims(doc).flatMap((claim) => {
    const live = tokens[claim.token];
    if (live === undefined) return [`${claim.token}: absent from the live sheet`];
    return normalizeHex(live) === claim.value
      ? []
      : [`${claim.token}: doc ${claim.value}, live ${normalizeHex(live)}`];
  });
}

export function mentionViolations(doc: string, tokens: TokenMap): readonly string[] {
  return parseMentionedTokens(doc).filter((token) => tokens[token] === undefined);
}

function buildRow(cells: readonly string[], value: string): ContrastRow {
  const nameCell = cells[0] ?? "";
  return {
    name: nameCell.replaceAll("`", "").trim(),
    value,
    isToken: nameCell.startsWith("`--"),
    ratios: cells.slice(2).map((cell) => Number.parseFloat(cell)),
    passes: cells.slice(2).map((cell) => RATIO_CELL.exec(cell)?.[1] === "AA"),
  };
}

export function parseContrastRows(doc: string): readonly ContrastRow[] {
  return doc.split("\n").flatMap((line) => {
    const cells = cellsOf(line);
    const hex = cells.length === 5 ? HEX_CELL.exec(cells[1] ?? "") : null;
    const captured = hex?.[1];
    return captured === undefined ? [] : [buildRow(cells, normalizeHex(captured))];
  });
}

export function contrastRow(doc: string, name: string): ContrastRow | undefined {
  return parseContrastRows(doc).find((row) => row.name === name);
}

function cellViolations(
  row: ContrastRow,
  value: string,
  ground: string,
  index: number,
  tokens: TokenMap,
): readonly string[] {
  const measured = contrastRatio(value, tokenValue(tokens, ground));
  const faults: string[] = [];
  if (Math.abs(measured - (row.ratios[index] ?? Number.NaN)) > 0.001) {
    faults.push(`${row.name} on ${ground}: doc ${String(row.ratios[index] ?? "missing")}, measured ${measured.toFixed(3)}`);
  }
  if ((measured >= AA_CONTRAST) !== (row.passes[index] ?? false)) {
    faults.push(`${row.name} on ${ground}: wrong verdict at ${measured.toFixed(3)}:1`);
  }
  return faults;
}

function rowViolations(row: ContrastRow, tokens: TokenMap): readonly string[] {
  const value = row.isToken ? normalizeHex(tokenValue(tokens, row.name)) : row.value;
  const fault = row.isToken && value !== row.value ? [`${row.name}: doc ${row.value}, live ${value}`] : [];
  return [...fault, ...AA_GROUNDS.flatMap((ground, index) => cellViolations(row, value, ground, index, tokens))];
}

export function contrastViolations(doc: string, tokens: TokenMap): readonly string[] {
  return parseContrastRows(doc).flatMap((row) => rowViolations(row, tokens));
}

export function upstreamMutedDecision(doc: string): string | undefined {
  return doc.split("\n").find((line) => line.includes("text-color-muted") && line.includes("not adopted"));
}

export function authorityViolations(docs: readonly DesignDoc[]): readonly string[] {
  return docs.flatMap((doc) =>
    doc.text.split("\n").flatMap((line, index) =>
      line.includes(DIRECTORY) && !SUPERSEDED.test(line) ? [`${doc.path}:${String(index + 1)}`] : []));
}
