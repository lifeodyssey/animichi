import { existsSync } from "node:fs";
import type { StorybookConfig } from "@storybook/react-vite";
import type { PluginOption } from "vite";
import { storybookAuthBoundary } from "./chat-chrome/storybook-auth-boundary";

function pluginName(plugin: PluginOption): string {
  if (Array.isArray(plugin)) return plugin.map(pluginName).join("|");
  if (plugin && typeof plugin === "object" && "name" in plugin && typeof plugin.name === "string") return plugin.name;
  return "";
}

function stripAppRuntimePlugins(plugins: PluginOption[] | undefined): PluginOption[] {
  return (plugins ?? []).filter((plugin) => !/tanstack-start|nitro/.test(pluginName(plugin)));
}

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  // Live-basemap stories mount real MapLibre against a local copy of the tile
  // assets (`wrangler r2 object get map-tiles-staging/...` into .cache/tiles);
  // the deployed /tiles prefix is Access-gated, so there is no remote to proxy.
  staticDirs: [
    "../public",
    ...(existsSync(new URL("../../../.cache/tiles", import.meta.url))
      ? [{ from: "../../../.cache/tiles", to: "/tiles" }]
      : []),
  ],
  framework: { name: "@storybook/react-vite", options: {} },
  // showcase.ts fails closed at module init — Storybook builds are never showcase.
  env: (env) => ({ ...env, VITE_SHOWCASE_MODE: "false" }),
  viteFinal: (viteConfig) => ({
    ...viteConfig,
    // Storybook's staticDirs owns these copies; Vite copying public too races mkdir.
    build: { ...viteConfig.build, copyPublicDir: false },
    plugins: [storybookAuthBoundary(), ...stripAppRuntimePlugins(viteConfig.plugins)],
  }),
};

export default config;
