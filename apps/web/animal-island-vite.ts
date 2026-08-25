import { fileURLToPath } from "node:url";
import type { Alias } from "vite";

type AnimalComponent = "Button" | "Input" | "Radio" | "Select" | "Switch";

function component(name: AnimalComponent): string {
  return fileURLToPath(new URL(`../../node_modules/animal-island-ui-tailwind/dist/es/components/${name}/${name}.js`, import.meta.url));
}

/** The package barrel eagerly evaluates an unrelated bundled ReactDOM client. */
export const animalIslandAliases: readonly Alias[] = [
  { find: "animal-island-ui-tailwind/button", replacement: component("Button") },
  { find: "animal-island-ui-tailwind/input", replacement: component("Input") },
  { find: "animal-island-ui-tailwind/radio", replacement: component("Radio") },
  { find: "animal-island-ui-tailwind/select", replacement: component("Select") },
  { find: "animal-island-ui-tailwind/switch", replacement: component("Switch") },
];
