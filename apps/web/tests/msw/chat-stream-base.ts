import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TEST_ORIGIN } from "./fixtures";

export const CHAT_URL = `${TEST_ORIGIN}/v1/chat`;
export const HEALTHZ_URL = `${TEST_ORIGIN}/healthz`;

/** Vitest runs with cwd = apps/web; the recordings live in the agent package. */
const FIXTURE_DIR = join(process.cwd(), "..", "agent", "tests", "fixtures", "chat_stream");

export type ChatStreamFixture = "search" | "clarify" | "error";

export function chatStreamFixture(name: ChatStreamFixture): string {
  return readFileSync(join(FIXTURE_DIR, `${name}.sse`), "utf8");
}

export interface ChatStreamOptions {
  /** Patch the recorded final frame's `session_id` (recordings capture null). */
  readonly sessionId?: string;
  /** Observe each request hitting the chat endpoint (headers assertions). */
  readonly spy?: (request: Request) => void;
  /** Corrupt the recorded final frame (type-invalid `success`) to probe schema guards. */
  readonly malformedFinal?: boolean;
  /** Serve this handler for a single request only (msw one-time handler). */
  readonly once?: boolean;
}

function patchSessionIdLine(line: string, sessionId: string): string {
  if (!line.startsWith('data: {"type":"data-response"')) return line;
  const frame = JSON.parse(line.slice("data: ".length)) as { data: Record<string, unknown> };
  if (!("success" in frame.data)) return line;
  frame.data.session_id = sessionId;
  return `data: ${JSON.stringify(frame)}`;
}

export function patchSessionId(text: string, sessionId?: string): string {
  if (!sessionId) return text;
  return text
    .split("\n")
    .map((line) => patchSessionIdLine(line, sessionId))
    .join("\n");
}

function corruptFinalFrame(text: string, malformed?: boolean): string {
  if (!malformed) return text;
  return text.replace('"success":true', '"success":"yep"');
}

export function streamText(name: ChatStreamFixture, options: ChatStreamOptions): string {
  return corruptFinalFrame(
    patchSessionId(chatStreamFixture(name), options.sessionId),
    options.malformedFinal,
  );
}
