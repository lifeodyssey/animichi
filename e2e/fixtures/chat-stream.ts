import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Browser-suite twins of apps/web/tests/msw/chat-handlers.ts: replay the REAL
 * agent stream recordings, with the same minimal patching discipline (session
 * id injection for the specs that assert on a specific id, final-envelope
 * transforms for the D-state variants until the backend error-boundary hook
 * ships recordings of the actual failure frames).
 *
 * The recordings describe the envelope the deployed edge sends, `session_id`
 * included (#1903): `responseChunks` in
 * `workers/edge/src/agent/views/public-content.ts` always writes one.
 */
const FIXTURE_DIR = join(__dirname, "..", "..", "packages", "contract", "fixtures", "chat-stream");

/** The session id the recordings assign, in every final full envelope. */
export const RECORDING_SESSION_ID = "s-fixture";

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

/** The recordings assign `RECORDING_SESSION_ID`; inject a specific id when a
 * spec has to assert on one (a recovery route it stubs by name). */
export function patchSessionId(recording: string, sessionId: string): string {
  return patchFinalFrame(recording, (envelope) => ({ ...envelope, session_id: sessionId }));
}
