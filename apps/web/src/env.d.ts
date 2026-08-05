/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Neon Auth (Better Auth) base URL, e.g. `https://…/neondb/auth`. Operator-supplied. */
  readonly VITE_NEON_AUTH_BASE_URL?: string;
  /**
   * Cloudflare Web Analytics site token, injected only by the production
   * deploy. Optional: an absent/empty value disables the beacon entirely.
   */
  readonly VITE_CF_BEACON_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
