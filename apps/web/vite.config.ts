import tailwindcss from "@tailwindcss/vite";
import { nitroV2Plugin } from "@tanstack/nitro-v2-vite-plugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { animalIslandAliases } from "./animal-island-vite";

export default defineConfig({
  // The one local dev port: `make dev-local` announces it, and
  // supabase/config.toml's site_url, scripts/local-login.sh and the Playwright
  // default base URL all assume it (test/repo-config/dev-local-port.test.rb
  // pins the pair). Without this, vite dev binds its default :5173; without
  // strictPort, vite hops to the next free port when :3000 is taken — either
  // way the announcement lies.
  server: { port: 3000, strictPort: true },
  resolve: { alias: animalIslandAliases, dedupe: ["react", "react-dom"] },
  plugins: [
    tailwindcss(),
    tanstackStart({
      // `@neondatabase/auth` mints a BroadcastChannel tab id with `crypto.randomUUID()`
      // at module scope. workerd evaluates every module top level outside an I/O context,
      // so the SDK merely reaching the server graph makes the Worker answer 500 to every
      // request. Wrangler's esbuild pass used to hide that by inlining dynamic imports
      // into lazy initialisers; main CD promotes Nitro's prebuilt chunks with `--no-bundle`,
      // which does not. Auth is a browser concern here, so the build fails rather than
      // ships a dead Worker — and the violation names the import chain that reintroduced it.
      importProtection: {
        behavior: "error",
        server: { specifiers: ["@neondatabase/auth", /^@neondatabase\/auth\//u] },
      },
    }),
    // compatibilityDate >= 2024-09-19 selects nitropack's modern assets-binding cloudflare-module preset (not legacy Workers Sites).
    // plugins paths resolve against srcDir (= this directory); nitroV2Plugin spreads this config into createNitro.
    nitroV2Plugin({
      preset: "cloudflare-module",
      compatibilityDate: "2025-07-15",
      plugins: ["./src/server/noindex-plugin.ts", "./src/server/runtime-config-plugin.ts"],
    }),
    viteReact(),
  ],
});
