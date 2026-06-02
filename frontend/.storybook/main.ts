import type { StorybookConfig } from "@storybook/react-vite";
import path from "node:path";

const config: StorybookConfig = {
  stories: ["../components/**/*.stories.@(ts|tsx)"],
  staticDirs: ["../public"],
  addons: ["@storybook/addon-designs"],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  viteFinal: async (config) => {
    config.resolve = config.resolve ?? {};
    const root = path.resolve(import.meta.dirname, "..");
    config.resolve.alias = {
      ...config.resolve.alias,
      "@": root,
      // Deduplicate React — prevents "Invalid hook call" from dual React copies
      "react": path.resolve(root, "node_modules/react"),
      "react-dom": path.resolve(root, "node_modules/react-dom"),
      "next/image": path.resolve(root, "tests/__mocks__/next/image.tsx"),
      "next/dynamic": path.resolve(import.meta.dirname, "mocks/next-dynamic.ts"),
    };
    config.css = config.css ?? {};
    config.css.postcss = path.resolve(import.meta.dirname, "..");

    // Define process.env for Next.js env vars used in client code
    config.define = {
      ...config.define,
      "process.env.NEXT_PUBLIC_RUNTIME_URL": JSON.stringify(""),
      "process.env.NEXT_PUBLIC_SUPABASE_URL": JSON.stringify("http://localhost:54321"),
      "process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY": JSON.stringify("mock-anon-key"),
      "process.env.NEXT_PUBLIC_MAPBOX_TOKEN": JSON.stringify(""),
      "process.env.NEXT_PUBLIC_MOCK_MODE": JSON.stringify("true"),
    };

    return config;
  },
};

export default config;
