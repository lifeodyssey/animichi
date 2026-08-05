/**
 * 1-10-50 enumerator for workers/* and packages/contract.
 *
 * Regex-based scanner (independent of scripts/panel-reference-scan.cjs, the
 * review seat's fixture, so the two cross-calibrate):
 *   - mask strings/templates/comments (newlines preserved inside masked spans)
 *   - DECL regexes find declaration starts; bodyOpen walks paren depth ACROSS
 *     lines to the first `{` at depth 0; skipReturnType skips a return-type
 *     object literal (`): { … } {` resolves to the second `{`)
 *   - span = body-open line .. body-close line (the fixture's convention)
 *   - report: named funcs span > 10, files over 300 (200 under test/),
 *     classes span > 50
 *
 * The tool does NOT exempt itself: it is measured by the same rules it applies.
 * Line counts use the wc -l convention (newline chars), not split("\n") — the
 * fixture counts a trailing newline as an extra line.
 *
 * Run: pnpm --filter catalog exec tsx scripts/enumerate-1050.ts
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const SCAN_DIRS = ["workers", "packages/contract"];
const EXCLUDE = /node_modules|\.wrangler|dist|coverage|\.turbo|\.oxlint|__snapshots__/;

const FUNC_LIMIT = 10;
const FILE_LIMIT = 300;
const FILE_LIMIT_TEST = 200;
const CLASS_LIMIT = 50;

const DECL = [
  /\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)?\s*(?:<[^()=]*>)?\s*\(/g,
  /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;]*)?=\s*(?:async\s+)?(?:<[^()=]*>\s*)?\(/g,
  /^[ \t]*(?:(?:public|private|protected|static|readonly|async|get|set)\s+)*([A-Za-z_$][\w$]*)\s*(?:<[^()=]*>)?\s*\(/gm,
  /([A-Za-z_$][\w$]*)\s*:\s*(?:async\s+)?\(/g,
];

const KEYWORD = new Set([
  "if", "for", "while", "switch", "catch", "return", "typeof", "await", "function",
  "new", "import", "require", "constructor", "super", "yield", "do", "else",
  "assert", "expect", "describe", "it", "test", "void",
]);

const STRING_RE = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g;
const LINE_RE = /\/\/[^\n]*/g;
const BLOCK_RE = /\/\*[\s\S]*?\*\//g;
const CLASS_RE = /\bclass\s+([A-Za-z_$][\w$]*)/g;

interface FuncViolation {
  file: string;
  name: string;
  line: number;
  span: number;
}

interface FileViolation {
  file: string;
  lines: number;
  limit: number;
}

function walk(dir: string, acc: string[]): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (EXCLUDE.test(full)) continue;
    if (entry.isDirectory()) walk(full, acc);
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) acc.push(full);
  }
  return acc;
}

function isTestPath(rel: string): boolean {
  return rel.endsWith(".test.ts") || rel.endsWith(".spike.ts") || rel.includes("/test/");
}

function blank(match: string): string {
  return match.replace(/[^\n]/g, " ");
}

function mask(src: string): string {
  const strings = src.replace(STRING_RE, blank);
  return strings.replace(LINE_RE, blank).replace(BLOCK_RE, blank);
}

function lineOf(masked: string, pos: number): number {
  let line = 1;
  for (let i = 0; i < pos; i += 1) if (masked[i] === "\n") line += 1;
  return line;
}

function parenStep(c: string, depth: number): number {
  if (c === "(") return depth + 1;
  if (c === ")") return depth - 1;
  return depth;
}

function braceStep(c: string, depth: number): number {
  if (c === "{") return depth + 1;
  if (c === "}") return depth - 1;
  return depth;
}

function matchBrace(masked: string, open: number): number {
  let depth = 0;
  for (let i = open; i < masked.length; i += 1) {
    depth = braceStep(masked[i] ?? "", depth);
    if (depth === 0) return i;
  }
  return -1;
}

function skipReturnType(masked: string, open: number): number {
  const close = matchBrace(masked, open);
  if (close < 0) return open;
  const a = masked[close + 1] ?? "";
  if (a === "{") return close + 1;
  if (a === "=" && masked[close + 2] === ">" && masked[close + 3] === "{") return close + 3;
  return open;
}

function bodyOpen(masked: string, open: number): number {
  let depth = 0;
  for (let i = open; i < masked.length; i += 1) {
    depth = parenStep(masked[i] ?? "", depth);
    if (depth < 0) return -1;
    if (depth > 0 || masked[i] === "(") continue;
    if (masked[i] === "{" || masked[i] === ";") return masked[i] === "{" ? skipReturnType(masked, i) : -1;
  }
  return -1;
}

function measureMatch(masked: string, match: RegExpExecArray): FuncViolation | null {
  const name = match[1];
  if (!name || KEYWORD.has(name)) return null;
  const body = bodyOpen(masked, match.index + match[0].length - 1);
  const close = body >= 0 ? matchBrace(masked, body) : -1;
  if (close < 0) return null;
  const start = lineOf(masked, body);
  return { name, line: start, span: lineOf(masked, close) - start + 1 };
}

function emit(masked: string, match: RegExpExecArray, seen: Set<string>, rel: string, out: FuncViolation[]): void {
  const v = measureMatch(masked, match);
  if (v === null || v.span <= FUNC_LIMIT) return;
  const key = `${String(v.line)}:${String(v.line + v.span - 1)}`;
  if (seen.has(key)) return;
  seen.add(key);
  out.push({ ...v, file: rel });
}

function scanDecls(masked: string, rel: string, seen: Set<string>, out: FuncViolation[]): void {
  for (const re of DECL) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(masked)) !== null) emit(masked, match, seen, rel, out);
  }
}

function classSpan(masked: string, match: RegExpExecArray): number | null {
  const open = masked.indexOf("{", match.index);
  const close = open >= 0 ? matchBrace(masked, open) : -1;
  if (close < 0) return null;
  return lineOf(masked, close) - lineOf(masked, open) + 1;
}

function scanClasses(masked: string, rel: string, out: FuncViolation[]): void {
  let match: RegExpExecArray | null;
  while ((match = CLASS_RE.exec(masked)) !== null) {
    const span = classSpan(masked, match);
    if (span !== null && span > CLASS_LIMIT) {
      out.push({ file: rel, name: match[1], line: lineOf(masked, match.index), span });
    }
  }
}

function scanFileLines(src: string, rel: string, out: FileViolation[]): void {
  const lines = (src.match(/\n/g) ?? []).length;
  const limit = isTestPath(rel) ? FILE_LIMIT_TEST : FILE_LIMIT;
  if (lines > limit) out.push({ file: rel, lines, limit });
}

function printReport(funcs: FuncViolation[], files: FileViolation[], classes: FuncViolation[]): void {
  console.log(`FUNCS >${String(FUNC_LIMIT)} (${String(funcs.length)})`);
  for (const v of funcs) console.log(`  ${v.file} ${v.name}:${String(v.line)}-${String(v.line + v.span - 1)} span=${String(v.span)}`);
  console.log(`FILES over limit (${String(files.length)})`);
  for (const v of files) console.log(`  ${v.file} lines=${String(v.lines)} > ${String(v.limit)}`);
  console.log(`CLASSES >${String(CLASS_LIMIT)} (${String(classes.length)})`);
  for (const v of classes) console.log(`  ${v.file} class ${v.name} span=${String(v.span)}`);
  console.log(`TOTALS: files=${String(files.length)} funcs=${String(funcs.length)} classes=${String(classes.length)}`);
}

function collectFiles(): string[] {
  const files: string[] = [];
  for (const dir of SCAN_DIRS) {
    const full = path.join(REPO_ROOT, dir);
    if (existsSync(full)) walk(full, files);
  }
  return files.sort();
}

function scanOne(file: string, funcs: FuncViolation[], classes: FuncViolation[], over: FileViolation[]): void {
  const src = readFileSync(file, "utf8");
  const rel = path.relative(REPO_ROOT, file);
  const masked = mask(src);
  const seen = new Set<string>();
  scanDecls(masked, rel, seen, funcs);
  scanClasses(masked, rel, classes);
  scanFileLines(src, rel, over);
}

function collectViolations(files: string[]): [FuncViolation[], FuncViolation[], FileViolation[]] {
  const funcs: FuncViolation[] = [];
  const classes: FuncViolation[] = [];
  const over: FileViolation[] = [];
  for (const file of files) scanOne(file, funcs, classes, over);
  return [funcs, classes, over];
}

function main(): void {
  const [funcs, classes, over] = collectViolations(collectFiles());
  printReport(funcs, over, classes);
}

main();
