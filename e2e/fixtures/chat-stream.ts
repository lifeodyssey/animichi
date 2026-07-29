import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Browser-suite twins of apps/web/tests/msw/chat-handlers.ts: replay the REAL
 * agent stream recordings, with the same minimal patching discipline (session
 * id injection, final-envelope transforms for the D-state variants until the
 * backend error-boundary hook ships recordings of the actual failure frames).
 */
const FIXTURE_DIR = join(__dirname, "..", "..", "apps", "agent", "tests", "fixtures", "chat_stream");

export const SSE_HEADERS = {
  "content-type": "text/event-stream",
  "x-vercel-ai-ui-message-stream": "v1",
};

export type ChatStreamFixture = "search" | "clarify" | "error";

export function chatStreamRecording(name: ChatStreamFixture): string {
  return readFileSync(join(FIXTURE_DIR, `${name}.sse`), "utf8");
}

export type EnvelopePatch = (envelope: Record<string, unknown>) => Record<string, unknown>;

interface DataResponseFrame {
  data: Record<string, unknown>;
}

function isFullFinalFrame(line: string): boolean {
  return line.startsWith('data: {"type":"data-response"');
}

function patchLine(line: string, patch: EnvelopePatch): string {
  if (!isFullFinalFrame(line)) return line;
  const frame = JSON.parse(line.slice("data: ".length)) as DataResponseFrame;
  if (!("success" in frame.data)) return line;
  frame.data = patch(frame.data);
  return `data: ${JSON.stringify(frame)}`;
}

/** Transform the recording's final full envelope (skeleton frames untouched). */
export function patchFinalFrame(recording: string, patch: EnvelopePatch): string {
  return recording.split("\n").map((line) => patchLine(line, patch)).join("\n");
}

/** The recordings capture a null session id; inject one for recovery flows. */
export function patchSessionId(recording: string, sessionId: string): string {
  return patchFinalFrame(recording, (envelope) => ({ ...envelope, session_id: sessionId }));
}
