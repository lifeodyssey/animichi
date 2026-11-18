/**
 * The request boundary: one node:http request in, one answer out, and the
 * process still serving after it.
 *
 * Everything node:http delivers reaches this module, including what the
 * handler's Web `Request` cannot hold: a method it refuses to carry (`TRACE`),
 * a target that is not a path (`*`, an absolute URL), a `Host` that is not a
 * host. The method and the target are answered here, in the handler's own
 * vocabulary, before anything is lifted. The lift then reads the target alone:
 * this service routes and signs by path, so the `Host` header is carried but
 * never parsed.
 *
 * Whatever still fails is answered too. The caller gets a plain 500 with no
 * egress marker, because no refusal reason in the caller's vocabulary says
 * "this service failed" and a new one would change that contract; once part
 * of an answer has been sent, the connection is closed instead. The service's
 * log gets one JSON line built from the failure alone: its name, its message
 * and its stack, each capped, and never the request's path, query or headers.
 */
import type { LogSink } from "./ceiling-store-log.ts";
import { handleEgressRequest, methodRefusal, noSuchOperation, type EgressDeps } from "./egress-service.ts";

/** The request half of node:http's pair, reduced to the three things the boundary reads. */
export interface InboundRequest {
  readonly method?: string;
  readonly url?: string;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
}

/** The response half, reduced to what an answer is written with and how a failed one is ended. */
export interface OutboundResponse {
  readonly headersSent: boolean;
  writeHead(status: number, headers: Record<string, string>): unknown;
  end(body?: Uint8Array): unknown;
  destroy(): unknown;
}

/** The origin every lifted request is given: a constant, so nothing the caller sends is parsed as a host. */
const LIFT_ORIGIN = "http://localhost";

/** The event a failure's log line is filed under. */
const FAILURE_EVENT = "request-failure";

/** The most of a failure's name, of its message and of its stack that its log line carries. */
const LOGGED_TEXT_LIMIT = 500;

/** Answer one request. Never rejects: a failure is logged as one line and answered, not thrown. */
export async function answerInboundRequest(request: InboundRequest, response: OutboundResponse, deps: EgressDeps, log: LogSink): Promise<void> {
  try {
    await writeAnswer(response, await answerTo(request, deps));
  } catch (cause) {
    contained(() => { log(failureLine(cause)); });
    answerFailure(response);
  }
}

/** The handler's answer, or the refusal a request gets when it cannot be lifted to ask the handler. */
async function answerTo(request: InboundRequest, deps: EgressDeps): Promise<Response> {
  const refused = methodRefusal(request.method);
  if (refused !== null) return refused;
  const target = request.url ?? "";
  if (!target.startsWith("/")) return noSuchOperation();
  return await handleEgressRequest(lifted(request, target), deps);
}

/** The one Request the handler reads: the target under the constant origin, with the method and headers as sent. GETs carry no body. */
function lifted(request: InboundRequest, target: string): Request {
  return new Request(`${LIFT_ORIGIN}${target}`, { method: request.method, headers: flatHeaders(request.headers) });
}

/** Write a whole answer: its body is read first, so a failure reading it leaves the response untouched. */
async function writeAnswer(response: OutboundResponse, answer: Response): Promise<void> {
  const body = new Uint8Array(await answer.arrayBuffer());
  response.writeHead(answer.status, headersToObject(answer.headers));
  response.end(body);
}

/** The failure's one log line, built from the failure and nothing else: no path, query or header can reach it. */
function failureLine(cause: unknown): string {
  const { error, message, stack } = failureFields(cause);
  const line = { event: FAILURE_EVENT, error: capped(error), message: capped(message), stack: capped(stack) };
  return `${JSON.stringify(line)}\n`;
}

/** What a thrown value says about itself. A thrown value that is not an error says only its type and its text. */
function failureFields(cause: unknown): { error: string; message: string; stack: string } {
  if (!(cause instanceof Error)) return { error: typeof cause, message: String(cause), stack: "" };
  return { error: cause.name, message: cause.message, stack: cause.stack ?? "" };
}

/** At most the first LOGGED_TEXT_LIMIT characters of `text`. */
function capped(text: string): string {
  return text.slice(0, LOGGED_TEXT_LIMIT);
}

/** The answer a failure gets: a plain 500 while nothing has been sent, a closed connection once something has. */
function answerFailure(response: OutboundResponse): void {
  const written = !response.headersSent && contained(() => { writePlainFailure(response); });
  if (!written) contained(() => { response.destroy(); });
}

/** A 500 with no egress marker and no body. */
function writePlainFailure(response: OutboundResponse): void {
  response.writeHead(500, {});
  response.end();
}

/** Run one step of answering a failure and say whether it finished. A step that throws has nowhere further to report to. */
function contained(step: () => void): boolean {
  try {
    step();
    return true;
  } catch {
    return false;
  }
}

/** Fetch `Headers` → the plain record node:http writes. */
function headersToObject(headers: Headers): Record<string, string> {
  const flat: Record<string, string> = {};
  headers.forEach((value, name) => { flat[name] = value; });
  return flat;
}

/** node:http's header record (values may repeat) → the single-valued form Request reads. */
function flatHeaders(headers: InboundRequest["headers"]): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value === "string") flat[name] = value;
    else if (Array.isArray(value) && value[0] !== undefined) flat[name] = value[0];
  }
  return flat;
}
