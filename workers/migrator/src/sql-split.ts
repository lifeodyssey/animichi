/** Split Atlas SQL into statements. Respects quotes, dollar-quotes, and comments. */

type Frame =
  | { kind: "code" }
  | { kind: "sq" }
  | { kind: "dq" }
  | { kind: "line" }
  | { kind: "block" }
  | { kind: "dollar"; tag: string };

type QuoteKind = Exclude<Frame["kind"], "dollar">;

interface Cursor {
  readonly src: string;
  i: number;
}

export function splitSql(src: string): string[] {
  const parts: string[] = [];
  scanStmts(cursor(src), src, parts);
  return parts;
}

export function needsTxNone(sql: string): boolean {
  return /\bCREATE\s+(UNIQUE\s+)?INDEX\s+CONCURRENTLY\b/i.test(codeText(sql));
}

function cursor(src: string): Cursor {
  return { src, i: 0 };
}

function peek(c: Cursor): string {
  return c.src[c.i] ?? "";
}

function peek2(c: Cursor): string {
  return c.src.slice(c.i, c.i + 2);
}

function take(c: Cursor): string {
  const ch = peek(c);
  c.i += 1;
  return ch;
}

function done(c: Cursor): boolean {
  return c.i >= c.src.length;
}

function scanStmts(c: Cursor, src: string, parts: string[]): void {
  let start = 0;
  let frame: Frame = { kind: "code" };
  while (!done(c)) {
    const next = scanStep(c, frame, src, start, parts);
    start = next.start;
    frame = next.frame;
  }
  pushStmt(parts, src, start, src.length);
}

function scanStep(
  c: Cursor,
  frame: Frame,
  src: string,
  start: number,
  parts: string[],
): { start: number; frame: Frame } {
  if (frame.kind !== "code" || peek(c) !== ";") return { start, frame: step(c, frame) };
  pushStmt(parts, src, start, c.i + 1);
  take(c);
  return { start: c.i, frame };
}

function pushStmt(parts: string[], src: string, start: number, end: number): void {
  const raw = src.slice(start, end).trim();
  if (raw.length > 0 && hasCode(raw)) parts.push(raw);
}

function hasCode(sql: string): boolean {
  const c = cursor(sql);
  let frame: Frame = { kind: "code" };
  while (!done(c)) {
    if (isPayload(frame.kind)) return true;
    const hit = scanCode(c, frame);
    if (hit.ok) return true;
    frame = hit.frame;
  }
  return false;
}

function isPayload(kind: Frame["kind"]): boolean {
  return kind === "sq" || kind === "dq" || kind === "dollar";
}

function scanCode(c: Cursor, frame: Frame): { ok: boolean; frame: Frame } {
  if (frame.kind === "code" && /\s/.test(peek(c))) {
    take(c);
    return { ok: false, frame };
  }
  if (frame.kind !== "code") return { ok: false, frame: step(c, frame) };
  const before = c.i;
  const next = step(c, frame);
  return { ok: next.kind === "code" && c.i > before, frame: next };
}

function codeText(sql: string): string {
  const c = cursor(sql);
  let frame: Frame = { kind: "code" };
  let out = "";
  while (!done(c)) {
    const piece = takeCode(c, frame);
    frame = piece.frame;
    out += piece.text;
  }
  return out;
}

function takeCode(c: Cursor, frame: Frame): { text: string; frame: Frame } {
  const text = frame.kind === "code" ? peek(c) : "";
  return { text, frame: step(c, frame) };
}

function step(c: Cursor, frame: Frame): Frame {
  if (frame.kind === "code") return stepCode(c);
  if (frame.kind === "sq") return stepQuote(c, "'", "sq");
  if (frame.kind === "dq") return stepQuote(c, '"', "dq");
  if (frame.kind === "line") return take(c) === "\n" ? { kind: "code" } : { kind: "line" };
  if (frame.kind === "block") return stepBlock(c);
  return stepDollar(c, frame);
}

function stepCode(c: Cursor): Frame {
  if (peek2(c) === "--") return enter(c, 2, "line");
  if (peek2(c) === "/*") return enter(c, 2, "block");
  if (peek(c) === "'") return enter(c, 1, "sq");
  if (peek(c) === '"') return enter(c, 1, "dq");
  const tag = readDollarTag(c);
  if (tag !== undefined) return { kind: "dollar", tag };
  take(c);
  return { kind: "code" };
}

function enter<K extends QuoteKind>(c: Cursor, n: number, kind: K): { kind: K } {
  c.i += n;
  return { kind };
}

function stepQuote<K extends "sq" | "dq">(c: Cursor, quote: string, kind: K): { kind: K } | { kind: "code" } {
  if (peek2(c) === quote + quote) {
    c.i += 2;
    return { kind };
  }
  if (peek(c) === quote) return enter(c, 1, "code");
  take(c);
  return { kind };
}

function stepBlock(c: Cursor): Frame {
  if (peek2(c) !== "*/") {
    take(c);
    return { kind: "block" };
  }
  c.i += 2;
  return { kind: "code" };
}

function stepDollar(c: Cursor, frame: Extract<Frame, { kind: "dollar" }>): Frame {
  const tag = readDollarTag(c);
  if (tag === frame.tag) return { kind: "code" };
  if (tag !== undefined) return frame;
  take(c);
  return frame;
}

function readDollarTag(c: Cursor): string | undefined {
  if (peek(c) !== "$") return undefined;
  const saved = c.i;
  take(c);
  const tag = takeIdent(c);
  if (peek(c) !== "$") {
    c.i = saved;
    return undefined;
  }
  take(c);
  return tag;
}

function takeIdent(c: Cursor): string {
  const start = c.i;
  if (!/[A-Za-z_]/.test(peek(c))) return "";
  take(c);
  while (/[A-Za-z0-9_]/.test(peek(c))) take(c);
  return c.src.slice(start, c.i);
}
