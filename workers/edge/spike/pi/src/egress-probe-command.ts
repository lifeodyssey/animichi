// W0-S5 spike (#1248): the request vocabulary of `POST /egress`.
//
// Deliberately permissive about `provider` and `baseUrl`: they arrive as raw
// strings and it is `EgressPolicy` that refuses an unknown family or a hostile
// URL. Validating them here first would mean the red-line matrix measured this
// parser instead of the guard it is supposed to measure.

export interface EgressProbeCommand {
  provider: string;
  baseUrl: string;
  key: string;
  prompt: string;
}

export type ParsedEgressProbeCommand =
  | { ok: true; command: EgressProbeCommand }
  | { ok: false; error: string };

export const DEFAULT_EGRESS_PROMPT = "Reply with the single word: ok.";

function asRecord(body: unknown): Record<string, unknown> | null {
  const isObject = typeof body === "object" && body !== null && !Array.isArray(body);
  return isObject ? (body as Record<string, unknown>) : null;
}

function readText(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

export function parseEgressProbeCommand(body: unknown): ParsedEgressProbeCommand {
  const record = asRecord(body);
  if (record === null) return { ok: false, error: "body must be a JSON object" };
  const baseUrl = readText(record, "baseUrl");
  if (baseUrl === null) return { ok: false, error: "baseUrl must be a string" };
  const provider = readText(record, "provider") ?? "";
  const key = readText(record, "key") ?? "";
  const prompt = readText(record, "prompt") ?? DEFAULT_EGRESS_PROMPT;
  return { ok: true, command: { provider, baseUrl, key, prompt } };
}
