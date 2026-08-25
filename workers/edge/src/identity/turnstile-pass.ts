import { TURNSTILE_WINDOW_MS } from "@animichi/contract/constants";
import { constantTimeEqual } from "./anonymous-id.ts";

const PASS_COOKIE = "turnstile_pass";

function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get("Cookie") ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name && rest.length > 0) return rest.join("=");
  }
  return null;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const bytes = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", bytes.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, bytes.encode(message));
  return Array.from(new Uint8Array(signature)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function payload(identity: string, expiresAt: number): string {
  return `${identity}\n${String(expiresAt)}`;
}

function cookie(value: string): string {
  const maxAge = Math.floor(TURNSTILE_WINDOW_MS / 1_000);
  return `${PASS_COOKIE}=${value}; Path=/; Max-Age=${String(maxAge)}; HttpOnly; Secure; SameSite=Lax`;
}

/** Issue an aid-bound proof; the single-use Turnstile token is never stored. */
export async function issueTurnstilePass(
  identity: string, secret: string, nowMs: number,
): Promise<string> {
  const expiresAt = nowMs + TURNSTILE_WINDOW_MS;
  const signature = await hmacHex(secret, payload(identity, expiresAt));
  return cookie(`${String(expiresAt)}.${signature}`);
}

function parsePass(value: string): { expiresAt: number; signature: string } | null {
  const match = /^(\d+)\.([0-9a-f]{64})$/.exec(value);
  if (match === null) return null;
  const expiresAt = Number(match[1]);
  const signature = match[2];
  if (!Number.isSafeInteger(expiresAt) || signature === undefined) return null;
  return { expiresAt, signature };
}

/** Validate the proof in any isolate against the resolved anonymous identity. */
export async function verifyTurnstilePass(
  request: Request, identity: string, secret: string, nowMs: number,
): Promise<boolean> {
  const value = readCookie(request, PASS_COOKIE);
  if (value === null) return false;
  const pass = parsePass(value);
  if (pass === null || pass.expiresAt <= nowMs) return false;
  const expected = await hmacHex(secret, payload(identity, pass.expiresAt));
  return constantTimeEqual(pass.signature, expected);
}
