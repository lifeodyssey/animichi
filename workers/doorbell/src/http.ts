import { tryParseJson } from "./triggers";

/** Start body for POST /builds: component + commit, both required. */
export interface StartBody {
  component: string;
  commit: string;
}

const COMMIT_RE = /^[0-9a-f]{40}$/;

export function bearerToken(request: Request): string | null {
  const header = request.headers.get("Authorization") ?? "";
  const scheme = /^bearer[ \t]+/i.exec(header);
  if (scheme === null) return null;
  const token = header.slice(scheme[0].length).trim();
  return token.length > 0 ? token : null;
}

/** JSON.parse returns `any`; narrow to `unknown` at the parse site. */
export function parseJson(raw: string): unknown {
  return JSON.parse(raw) as unknown;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function startBodyOf(record: Record<string, unknown>): StartBody | null {
  const component = record.component;
  const commit = record.commit;
  if (typeof component !== "string" || component.length === 0) return null;
  if (typeof commit !== "string" || !COMMIT_RE.test(commit)) return null;
  return { component, commit };
}

export async function parseStartBody(request: Request): Promise<{ ok: true; value: StartBody } | { ok: false }> {
  const parsed = tryParseJson(await request.text());
  if (!isRecord(parsed)) return { ok: false };
  const body = startBodyOf(parsed);
  return body === null ? { ok: false } : { ok: true, value: body };
}
