import type { StorybookConfig } from "@storybook/react-vite";
import path from "node:path";

const config: StorybookConfig = {
  stories: ["../components/**/*.stories.@(ts|tsx)"],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  viteFinal: async (config) => {
    config.resolve = config.resolve ?? {};
    config.resolve.alias = {
      ...config.resolve.alias,
      "@": path.resolve(import.meta.dirname, ".."),
      "next/image": path.resolve(import.meta.dirname, "../tests/__mocks__/next/image.tsx"),
      "next/dynamic": path.resolve(import.meta.dirname, "mocks/next-dynamic.ts"),
    };
    config.css = config.css ?? {};
    config.css.postcss = path.resolve(import.meta.dirname, "..");
    return config;
  },
};

export default config;
