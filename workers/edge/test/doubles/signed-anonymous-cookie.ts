export const TEST_ANON_SECRET = "fixed-test-hmac-key-0000000000000000";

export async function signedAidCookie(userId: string): Promise<string> {
  const raw = userId.replace(/^anon_/, "");
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(TEST_ANON_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(raw));
  const hex = Array.from(new Uint8Array(signature)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `aid=${raw}.${hex}`;
}
