import { gatewayRejection } from "../gateway/responses.ts";

const SESSION_ID_QUERY_KEY = "session_id";
const SESSION_ID_HEADER = "x-session-id";
export const MAX_BODY_BYTES = 1024;

type BodyProbe = { kind: "ok"; bytes: Uint8Array } | { kind: "too_large" };
interface BodyReader {
  read(): Promise<{ done: boolean; value?: Uint8Array }>;
  cancel(): Promise<void>;
  releaseLock(): void;
}
type BodyStep = BodyProbe | { kind: "continue"; length: number };

function clientSessionIdRejection(): Response {
  return gatewayRejection("invalid_request", 400, "Client session ids are not accepted.");
}

function bodyTooLargeRejection(): Response {
  return gatewayRejection("http_error", 413, "Request body too large.");
}

function declaredBodyTooLarge(request: Request): boolean {
  const length = request.headers.get("content-length");
  return length !== null && /^\d+$/.test(length) && Number(length) > MAX_BODY_BYTES;
}

function joinBodyChunks(chunks: Uint8Array[], length: number): Uint8Array {
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function cancelBody(reader: BodyReader): Promise<BodyStep> {
  await reader.cancel();
  return { kind: "too_large" };
}

async function readBodyChunk(reader: BodyReader, chunks: Uint8Array[], length: number): Promise<BodyStep> {
  const { done, value } = await reader.read();
  if (done) return { kind: "ok", bytes: joinBodyChunks(chunks, length) };
  if (!value) return { kind: "continue", length };
  const nextLength = length + value.byteLength;
  if (nextLength > MAX_BODY_BYTES) return cancelBody(reader);
  chunks.push(value);
  return { kind: "continue", length: nextLength };
}

async function collectBody(reader: BodyReader): Promise<BodyProbe> {
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const step = await readBodyChunk(reader, chunks, length);
    if (step.kind !== "continue") return step;
    length = step.length;
  }
}

async function readBodyProbe(request: Request): Promise<BodyProbe> {
  if (!request.body) return { kind: "ok", bytes: new Uint8Array() };
  const reader: BodyReader = request.body.getReader();
  try {
    return await collectBody(reader);
  } finally {
    reader.releaseLock();
  }
}

function hasClientSessionId(payload: unknown): boolean {
  return typeof payload === "object" && payload !== null && !Array.isArray(payload) && SESSION_ID_QUERY_KEY in payload;
}

function parseBodyProbe(probe: BodyProbe): Response | null {
  if (probe.kind === "too_large") return bodyTooLargeRejection();
  if (probe.bytes.byteLength === 0) return null;
  try {
    const payload: unknown = JSON.parse(new TextDecoder().decode(probe.bytes));
    return hasClientSessionId(payload) ? clientSessionIdRejection() : null;
  } catch {
    return clientSessionIdRejection();
  }
}

/** Refuse client-controlled session ids before any adoption write opens. */
export async function rejectClientSessionId(request: Request): Promise<Response | null> {
  const params = new URL(request.url).searchParams;
  if (params.has(SESSION_ID_QUERY_KEY) || request.headers.has(SESSION_ID_HEADER)) return clientSessionIdRejection();
  if (declaredBodyTooLarge(request)) return bodyTooLargeRejection();
  return parseBodyProbe(await readBodyProbe(request));
}
