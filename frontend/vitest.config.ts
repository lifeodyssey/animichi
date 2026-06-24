import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

/** Stub binary asset imports (png/svg/webp/woff2) that animal-island-ui references */
function assetStubPlugin() {
  return {
    name: "asset-stub",
    transform(_code: string, id: string) {
      if (/\.(png|jpe?g|webp|gif|woff2?|eot|ttf|otf)$/.test(id)) {
        return { code: "export default '';" };
      }
      if (id.endsWith(".svg") && !id.includes("?")) {
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
      include: ["components/**", "lib/**"],
      exclude: ["**/node_modules/**", "components/ui/**", "**/*.stories.tsx"],
      // Floors based on current coverage — only ratchet UP, never lower.
      // Ratcheted up after the homepage-only cleanup (non-landing pages removed);
      // measured: lines 88.7, functions 72.6, branches 86.6.
      thresholds: {
        lines: 85,
        statements: 82,
        functions: 71,
        branches: 80,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
      "next/image": path.resolve(__dirname, "./tests/__mocks__/next/image.tsx"),
      "react": require.resolve("react"),
      "react-dom": require.resolve("react-dom"),
      "react/jsx-runtime": require.resolve("react/jsx-runtime"),
      "react/jsx-dev-runtime": require.resolve("react/jsx-dev-runtime"),
    },
  },
});
