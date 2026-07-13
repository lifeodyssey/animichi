export type CsvRow = Readonly<Record<string, string>>;
interface CsvState { fields: string[]; field: string; quoted: boolean }

function pushField(fields: string[], field: string): void {
  fields.push(field);
}

function consume(state: CsvState, line: string, index: number): number {
  const char = line[index] ?? "";
  if (char === '"' && state.quoted && line[index + 1] === '"') { state.field += '"'; return index + 1; }
  if (char === '"') { state.quoted = !state.quoted; return index; }
  if (char === "," && !state.quoted) { pushField(state.fields, state.field); state.field = ""; return index; }
  state.field += char;
  return index;
}

function parseCsvLine(line: string): string[] {
  const state: CsvState = { fields: [], field: "", quoted: false };
  for (let index = 0; index < line.length; index += 1) index = consume(state, line, index);
  pushField(state.fields, state.field);
  return state.fields;
}

function requireHeaders(headers: readonly string[], required: readonly string[]): void {
  const missing = required.filter((header) => !headers.includes(header));
  if (missing.length) throw new Error(`Missing required CSV headers: ${missing.join(", ")}`);
}

function toRow(headers: readonly string[], values: readonly string[]): CsvRow {
  return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
}

export function parseCsv(text: string, required: readonly string[]): CsvRow[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/u).filter((line) => line.length > 0);
  const headers = parseCsvLine(lines[0] ?? "").map((header) => header.trim());
  requireHeaders(headers, required);
  return lines.slice(1).map(parseCsvLine).map((values) => toRow(headers, values));
}
