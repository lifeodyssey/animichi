/// <reference types="vite/client" />

declare module "animal-island-ui-tailwind/button" {
  export { Button } from "animal-island-ui-tailwind";
}

declare module "animal-island-ui-tailwind/drawer" {
  export { Drawer } from "animal-island-ui-tailwind";
}

declare module "animal-island-ui-tailwind/tooltip" {
  export { Tooltip } from "animal-island-ui-tailwind";
}

// Projects define no custom VITE_* variables (#1013 AC1): environment-varying
// PUBLIC config lives in the versioned runtime-config module
// (src/lib/runtime-config) that the ONE built artifact loads at runtime. Only
// Vite's own build-invariant flags (PROD/DEV, supplied by vite/client) remain.
