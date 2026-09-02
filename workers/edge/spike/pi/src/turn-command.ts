// W0-S1 spike (#1244): the request vocabulary of the pi-agent-core probe
// Worker. Pure — no bindings, no SDK — so the routing and validation contract
// is testable under node:test.

export const SPIKE_PROVIDERS = ["mimo", "anthropic", "gemini"] as const;
export type SpikeProvider = (typeof SPIKE_PROVIDERS)[number];

// The three break points the S1 acceptance criteria name: abort while the
// provider stream is still producing deltas, abort while a tool call is
// executing, abort after the last turn closes but before `agent_end` — the
// final frame.
export const ABORT_POINTS = ["provider_stream", "tool_call", "final_frame"] as const;
export type AbortPoint = (typeof ABORT_POINTS)[number];

export const DEFAULT_TURN_PROMPT =
  "Look up the pilgrimage spot for the anime Hyouka using the tool, then answer in one sentence.";

export interface TurnCommand {
  provider: SpikeProvider;
  prompt: string;
  abortPoint: AbortPoint | null;
}

export type ParsedTurnCommand =
  | { ok: true; command: TurnCommand }
  | { ok: false; error: string };

function asRecord(body: unknown): Record<string, unknown> | null {
  const isObject = typeof body === "object" && body !== null && !Array.isArray(body);
  return isObject ? (body as Record<string, unknown>) : null;
}

function readText(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readProvider(record: Record<string, unknown>): SpikeProvider | null {
  const provider = readText(record, "provider");
  return SPIKE_PROVIDERS.find((known) => known === provider) ?? null;
}

function readAbortPoint(record: Record<string, unknown>): AbortPoint | null {
  const point = readText(record, "abortPoint");
  return ABORT_POINTS.find((known) => known === point) ?? null;
}

function completeCommand(
  record: Record<string, unknown>,
  provider: SpikeProvider,
  abortRequired: boolean,
): ParsedTurnCommand {
  const abortPoint = readAbortPoint(record);
  if (abortRequired && abortPoint === null) {
    return { ok: false, error: `abortPoint must be one of ${ABORT_POINTS.join(", ")}` };
  }
  const prompt = readText(record, "prompt") ?? DEFAULT_TURN_PROMPT;
  return { ok: true, command: { provider, prompt, abortPoint: abortRequired ? abortPoint : null } };
}

/** `abortRequired` distinguishes POST /turn/abort from POST /turn. */
export function parseTurnCommand(body: unknown, abortRequired: boolean): ParsedTurnCommand {
  const record = asRecord(body);
  if (record === null) return { ok: false, error: "body must be a JSON object" };
  const provider = readProvider(record);
  if (provider === null) {
    return { ok: false, error: `provider must be one of ${SPIKE_PROVIDERS.join(", ")}` };
  }
  return completeCommand(record, provider, abortRequired);
}
