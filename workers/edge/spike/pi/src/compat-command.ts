// W0-S2 spike (#1245): the request vocabulary of `POST /compat`. Pure — no
// bindings, no SDK — so the validation contract is testable under node:test.
//
// Validation is strict on purpose: an override the parser quietly dropped
// would produce a measured row that names a switch the request never actually
// carried, which is worse than no row at all.

import {
  BOOLEAN_SWITCHES,
  MAX_TOKENS_FIELDS,
  MIMO_ROUTES,
  isMimoRoute,
  type BooleanSwitch,
  type MaxTokensField,
  type MimoCompat,
  type MimoRouteName,
} from "./compat-switch.ts";

export const DEFAULT_COMPAT_PROMPT =
  "Look up the pilgrimage spot for the anime Hyouka with the lookup_spot tool, then answer in one sentence.";

export interface CompatCommand {
  route: MimoRouteName;
  compat: MimoCompat;
  prompt: string;
}

export type ParsedCompatCommand =
  | { ok: true; command: CompatCommand }
  | { ok: false; error: string };

function asRecord(body: unknown): Record<string, unknown> | null {
  const isObject = typeof body === "object" && body !== null && !Array.isArray(body);
  return isObject ? (body as Record<string, unknown>) : null;
}

function booleanSwitchOf(name: string): BooleanSwitch | null {
  return BOOLEAN_SWITCHES.find((known) => known === name) ?? null;
}

type CompatField = { ok: true; compat: MimoCompat } | { ok: false; error: string };

function booleanFieldOf(name: BooleanSwitch, value: unknown): CompatField {
  if (typeof value !== "boolean") return { ok: false, error: `compat.${name} must be a boolean` };
  return { ok: true, compat: { [name]: value } };
}

function maxTokensFieldOf(value: unknown): CompatField {
  const field: MaxTokensField | undefined = MAX_TOKENS_FIELDS.find((known) => known === value);
  if (field === undefined) {
    return { ok: false, error: `compat.maxTokensField must be one of ${MAX_TOKENS_FIELDS.join(", ")}` };
  }
  return { ok: true, compat: { maxTokensField: field } };
}

function fieldOf(name: string, value: unknown): CompatField {
  const known = booleanSwitchOf(name);
  if (known !== null) return booleanFieldOf(known, value);
  if (name === "maxTokensField") return maxTokensFieldOf(value);
  return { ok: false, error: `unknown compat switch ${name}` };
}

function compatOf(value: unknown): CompatField {
  if (value === undefined) return { ok: true, compat: {} };
  const record = asRecord(value);
  if (record === null) return { ok: false, error: "compat must be a JSON object" };
  let compat: MimoCompat = {};
  for (const [name, entry] of Object.entries(record)) {
    const field = fieldOf(name, entry);
    if (!field.ok) return field;
    compat = { ...compat, ...field.compat };
  }
  return { ok: true, compat };
}

type ParsedPrompt = { ok: true; prompt: string } | { ok: false; error: string };

// Absent means "use the tool-calling prompt". Present-but-unusable is an
// operator mistake, and defaulting it would produce a measured row taken under
// a prompt the request never asked for.
function promptOf(record: Record<string, unknown>): ParsedPrompt {
  if (!("prompt" in record)) return { ok: true, prompt: DEFAULT_COMPAT_PROMPT };
  const value = record.prompt;
  if (typeof value !== "string" || value.length === 0) {
    return { ok: false, error: "prompt must be a non-empty string when present" };
  }
  return { ok: true, prompt: value };
}

export function parseCompatCommand(body: unknown): ParsedCompatCommand {
  const record = asRecord(body);
  if (record === null) return { ok: false, error: "body must be a JSON object" };
  const route = record.route;
  if (typeof route !== "string" || !isMimoRoute(route)) {
    return { ok: false, error: `route must be one of ${MIMO_ROUTES.join(", ")}` };
  }
  const compat = compatOf(record.compat);
  if (!compat.ok) return compat;
  const prompt = promptOf(record);
  if (!prompt.ok) return prompt;
  return { ok: true, command: { route, compat: compat.compat, prompt: prompt.prompt } };
}
