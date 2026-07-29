import { z } from "zod";
import { sessionHeaders } from "./session-headers";

/**
 * Client for `POST /v1/byok/probe` (issue #284 Task 5/D5, consumed by the
 * Task 6 settings panel). One request does double duty (OQ-2): it validates
 * the saved credential AND detects vision capability. Task 5 is landing in
 * parallel — the response contract below is written against the spec's
 * pinned shape (`{"vision", "reachable", "error_code"}`), and the unit suite
 * exercises it through MSW; the live wire is a Tester browser AC.
 *
 * The failure taxonomy is deliberately collapsed server-side (spec P2-1):
 * only auth outcomes are distinguishable, everything else is the opaque
 * `provider_unreachable`. This module mirrors that: it never surfaces a
 * provider-specific reason the server refused to leak.
 */

export type ByokProbeOutcome =
  | { readonly kind: "ok"; readonly vision: boolean; readonly definitive: boolean }
  | { readonly kind: "rejected" }
  | { readonly kind: "unreachable" }
  | { readonly kind: "invalid"; readonly code: "invalid_request" | "egress_blocked" }
  | { readonly kind: "requires_login" }
  | { readonly kind: "error" };

const ProbeBody = z.object({
  vision: z.boolean(),
  reachable: z.boolean(),
  error_code: z.string().nullable(),
});

const ErrorBody = z.object({ error: z.object({ code: z.string() }) });

export function byokProbeUrl(baseUrl: string): string {
  return new URL("/v1/byok/probe", baseUrl).toString();
}

/**
 * `definitive` (#479 review, P2-1): only a clean probe — `error_code === null`
 * — is an authoritative verdict on vision support. The server may widen the
 * `error_code` domain (429/404/5xx reclassifications are under review), so a
 * `vision: false` accompanied by ANY code is treated as "not yet known", and
 * unknown codes fall through to the default arms rather than an exhaustive
 * switch.
 */
function reachableOutcome(body: z.infer<typeof ProbeBody>): ByokProbeOutcome {
  if (body.reachable) return { kind: "ok", vision: body.vision, definitive: body.error_code === null };
  if (body.error_code === "byok_credential_rejected") return { kind: "rejected" };
  return { kind: "unreachable" };
}

async function errorCodeOf(response: Response): Promise<string | undefined> {
  const parsed = ErrorBody.safeParse(await response.json().catch(() => undefined));
  return parsed.success ? parsed.data.error.code : undefined;
}

function forbiddenOutcome(code: string | undefined): ByokProbeOutcome {
  return code === "byok_credential_rejected" ? { kind: "rejected" } : { kind: "requires_login" };
}

function invalidOutcome(code: string | undefined): ByokProbeOutcome {
  if (code === "egress_blocked") return { kind: "invalid", code };
  return { kind: "invalid", code: "invalid_request" };
}

async function failureOutcome(response: Response): Promise<ByokProbeOutcome> {
  const code = await errorCodeOf(response);
  if (response.status === 400) return invalidOutcome(code);
  if (response.status === 401) return { kind: "requires_login" };
  if (response.status === 403) return forbiddenOutcome(code);
  return { kind: "error" };
}

async function successOutcome(response: Response): Promise<ByokProbeOutcome> {
  const parsed = ProbeBody.safeParse(await response.json().catch(() => undefined));
  return parsed.success ? reachableOutcome(parsed.data) : { kind: "error" };
}

async function outcomeOf(response: Response): Promise<ByokProbeOutcome> {
  return response.ok ? successOutcome(response) : failureOutcome(response);
}

async function probeRequest(baseUrl: string): Promise<Response> {
  return fetch(byokProbeUrl(baseUrl), { method: "POST", headers: await sessionHeaders() });
}

/** Fire one probe with the shared session identity + saved BYOK headers. */
export async function runByokProbe(baseUrl: string): Promise<ByokProbeOutcome> {
  try {
    return await outcomeOf(await probeRequest(baseUrl));
  } catch {
    return { kind: "error" };
  }
}
