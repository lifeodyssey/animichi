import tailwindcss from "@tailwindcss/vite";
import { nitroV2Plugin } from "@tanstack/nitro-v2-vite-plugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    tailwindcss(),
    tanstackStart(),
    // compatibilityDate >= 2024-09-19 selects nitropack's modern assets-binding cloudflare-module preset (not legacy Workers Sites).
    // plugins paths resolve against srcDir (= this directory); nitroV2Plugin spreads this config into createNitro.
    nitroV2Plugin({
      preset: "cloudflare-module",
      compatibilityDate: "2025-07-15",
      plugins: ["./src/server/noindex-plugin.ts"],
    }),
    viteReact(),
  ],
});
