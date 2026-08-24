import { fileURLToPath } from "node:url";
import type { Alias } from "vite";

function component(name: "Button" | "Drawer" | "Tooltip"): string {
  return fileURLToPath(new URL(`../../node_modules/animal-island-ui-tailwind/dist/es/components/${name}/${name}.js`, import.meta.url));
}

/** The package barrel eagerly evaluates an unrelated bundled ReactDOM client. */
export const animalIslandAliases: readonly Alias[] = [
  { find: "animal-island-ui-tailwind/button", replacement: component("Button") },
  { find: "animal-island-ui-tailwind/drawer", replacement: component("Drawer") },
  { find: "animal-island-ui-tailwind/tooltip", replacement: component("Tooltip") },
];
