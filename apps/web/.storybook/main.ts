import type { StorybookConfig } from "@storybook/react-vite";
import type { PluginOption } from "vite";

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
  staticDirs: ["../public"],
  framework: { name: "@storybook/react-vite", options: {} },
  docs: { autodocs: "tag" },
  viteFinal: (viteConfig) => ({ ...viteConfig, plugins: stripAppRuntimePlugins(viteConfig.plugins) }),
};

export default config;
