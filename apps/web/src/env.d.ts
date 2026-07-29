/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Neon Auth (Better Auth) base URL, e.g. `https://…/neondb/auth`. Operator-supplied. */
  readonly VITE_NEON_AUTH_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
