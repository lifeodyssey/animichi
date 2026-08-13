import { describe, expect, it } from "vitest";

const sourceFiles = import.meta.glob("../../src/**/*.{ts,tsx}", {
  eager: true,
  import: "default",
  query: "?raw",
});
const source = Object.values(sourceFiles).join("\n");
// AC1 (#1013): the environment-varying PUBLIC config must NOT be read from
// build-time VITE_* variables — it moved into the versioned runtime config the
// ONE artifact loads at runtime. A VITE_* read here is baked into the bundle at
// build time, which is precisely what the deploy-promotion work removes. The
// regex tracks BOTH the pure-function `env.VITE_*` form and
// `import.meta.env.VITE_*`; build-invariant flags (PROD/DEV) are Vite-native,
// not VITE_-prefixed, so they never match.
const readNames = new Set(
  [...source.matchAll(/\b(?:env|import\.meta\.env)\.(VITE_[A-Z0-9_]+)/g)].map((match) => match[1]),
);

describe("deploy workflow Vite build environment", () => {
  it("AC1: apps/web/src reads NO VITE_* build-time value", () => {
    // The versioned runtime config (src/lib/runtime-config) is the only source
    // of environment-varying PUBLIC values now. Any VITE_* read here would bake
    // a staging/production value into the artifact, breaking the ONE-artifact
    // promotion premise (#1013 AC1).
    expect([...readNames]).toEqual([]);
  });
});
