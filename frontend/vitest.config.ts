import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

/** Stub binary asset imports (png/svg/webp/woff2) that animal-island-ui references */
function assetStubPlugin() {
  return {
    name: "asset-stub",
    transform(_code: string, id: string) {
      if (/\.(png|jpe?g|webp|gif|woff2?|eot|ttf|otf)$/.test(id)) {
        return { code: "export default '';" };
      }
      if (/\.svg$/.test(id) && !id.includes("?")) {
        return { code: "export default '';" };
      }
      return undefined;
    },
  };
}

export default defineConfig({
  root: __dirname,
  plugins: [react(), assetStubPlugin()],
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],

    exclude: [
      "**/node_modules/**",
    ],
    server: {
      deps: {
        inline: ["animal-island-ui"],
      },
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["components/**", "hooks/**", "lib/**", "contexts/**"],
      exclude: ["**/node_modules/**", "lib/mock-data/**", "components/ui/**", "**/*.stories.tsx"],
      // Floors based on current coverage — only ratchet UP, never lower.
      // Ratcheted up after the Animal Island redesign (Waves 0–3) added well-tested components.
      thresholds: {
        lines: 73,
        statements: 69,
        functions: 65,
        branches: 60,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
      "next/image": path.resolve(__dirname, "./tests/__mocks__/next/image.tsx"),
      "react": path.resolve(__dirname, "./node_modules/react"),
      "react-dom": path.resolve(__dirname, "./node_modules/react-dom"),
      "react/jsx-runtime": path.resolve(__dirname, "./node_modules/react/jsx-runtime"),
      "react/jsx-dev-runtime": path.resolve(__dirname, "./node_modules/react/jsx-dev-runtime"),
    },
  },
});
