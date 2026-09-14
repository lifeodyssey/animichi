import type { MagicLinkResult } from "../../src/lib/auth/neon-auth";

/** Visual previews never send login emails or claim that a user authenticated. */
export function sendMagicLink(): Promise<MagicLinkResult> {
  return Promise.resolve("not_configured");
}
