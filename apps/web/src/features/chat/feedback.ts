import type { SubmitFeedbackRequest } from "@animichi/contract";
import { SubmitFeedbackResult } from "@animichi/contract";
import { authHeaders } from "../../lib/auth/auth-session";

/**
 * Client for `POST /v1/feedback` (AGENT-3 #962). The wire contract is the
 * generated boundary from `@animichi/contract` — the request is sent as-is
 * (blank-after-trim is a server-owned rule) and the success body is parsed
 * with the generated `SubmitFeedbackResult`, so this caller can never drift
 * from the emitted Pydantic model. The edge requires a Neon identity for
 * this route, so the Bearer token from `authHeaders()` is the identity
 * carrier; the server owns session ownership when a session_id is present.
 */

export type SubmitFeedbackInput = SubmitFeedbackRequest;

export function feedbackUrl(baseUrl: string): string {
  return `${baseUrl}/v1/feedback`;
}

/** Submit one feedback record; resolves to the server-issued feedback id. */
export async function submitFeedback(
  baseUrl: string,
  payload: SubmitFeedbackInput,
): Promise<string> {
  const headers = await authHeaders();
  const response = await postJson(feedbackUrl(baseUrl), headers, payload);
  if (!response.ok) throw new Error(`feedback responded ${String(response.status)}`);
  return SubmitFeedbackResult.parse(await response.json()).feedback_id;
}

async function postJson(
  url: string,
  headers: HeadersInit,
  payload: SubmitFeedbackInput,
): Promise<Response> {
  const h = new Headers(headers);
  h.set("Content-Type", "application/json");
  return fetch(url, { method: "POST", headers: h, body: JSON.stringify(payload) });
}
