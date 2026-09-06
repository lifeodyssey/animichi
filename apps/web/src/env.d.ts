/// <reference types="vite/client" />

declare module "animal-island-ui-tailwind/button" {
  export { Button } from "animal-island-ui-tailwind";
}

declare module "animal-island-ui-tailwind/input" {
  export { Input } from "animal-island-ui-tailwind";
}

declare module "animal-island-ui-tailwind/radio" {
  export { Radio } from "animal-island-ui-tailwind";
}

declare module "animal-island-ui-tailwind/select" {
  export { Select } from "animal-island-ui-tailwind";
  export type { SelectOption } from "animal-island-ui-tailwind";
}

declare module "animal-island-ui-tailwind/switch" {
  export { Switch } from "animal-island-ui-tailwind";
}

// Projects define no custom VITE_* variables (#1013 AC1): environment-varying
// PUBLIC config lives in the versioned runtime-config module
// (src/lib/runtime-config) that the ONE built artifact loads at runtime. Only
// Vite's own build-invariant flags (PROD/DEV, supplied by vite/client) remain.

